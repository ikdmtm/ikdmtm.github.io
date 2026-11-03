// Composes the diorama: backdrop, ground plane, soil section, nest, and creatures.
import { W, SOIL_H, SURF_D, FORE, SKY_H, ENTRANCE, MIDDEN, FOODS, ROLE_NAMES, PX_PER_CM } from '../sim/config.js';
import { PCOLS, PROWS, PG } from '../sim/surface.js';
import { MG, MCOLS, MROWS } from '../sim/surface.js';
import { Rng, clamp } from '../sim/rng.js';
import { cx, cy } from '../sim/nest.js';
import { makeCanvas, makeSoilCanvas, makeGroundCanvas, makeCavityTile, makeFlora, makeSnowCanvas, makeLeafCanvas, PELLET_COLORS } from './textures.js';
import { buildNestOutline } from './contour.js';
import { drawAnt, drawEgg, drawLarva, drawPupa, drawFood, drawStone, drawPlant, drawSeed, leafRGB } from './draw.js';

const TAU = Math.PI * 2;
const PLANE_H = SURF_D * FORE;
export const TOP = -(PLANE_H + SKY_H);
const ANT_SQ = 0.62;
const TEX = 2;

const SKY_KEYS = [
  [0.00, [14, 22, 44], [38, 48, 78]],
  [0.20, [26, 36, 70], [70, 70, 100]],
  [0.25, [90, 115, 160], [242, 186, 146]],
  [0.32, [140, 186, 222], [236, 232, 212]],
  [0.50, [118, 172, 220], [226, 234, 228]],
  [0.72, [120, 160, 205], [240, 222, 190]],
  [0.79, [72, 80, 130], [238, 150, 106]],
  [0.85, [24, 32, 62], [58, 60, 96]],
  [1.00, [14, 22, 44], [38, 48, 78]],
];
function skyAt(t) {
  for (let i = 1; i < SKY_KEYS.length; i++) {
    const [t1, a1, b1] = SKY_KEYS[i];
    if (t <= t1) {
      const [t0, a0, b0] = SKY_KEYS[i - 1], k = (t - t0) / (t1 - t0);
      return [a0.map((v, j) => v + (a1[j] - v) * k), b0.map((v, j) => v + (b1[j] - v) * k)];
    }
  }
  return [SKY_KEYS[0][1], SKY_KEYS[0][2]];
}
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: W / 2, y: 120, zoom: 1 };
    this.target = null;
    this.dpr = 1; this.vw = 1; this.vh = 1;
    this.showPheromone = false;
    this.showLabels = true;
    this.selected = null;
    this.ghost = null;
    this.particles = [];
    this.outline = null; this.outlineVersion = -1; this.outlineTime = 0;
    this.pherTime = 0;
    this.time = 0;
  }

  attach(col) {
    this.col = col;
    this.soilTex = makeSoilCanvas(col.soil, col.seed, TEX);
    this.groundTex = makeGroundCanvas(col.surface, col.seed, TEX);
    this.cavityTile = makeCavityTile();
    this.flora = makeFlora(col.surface, col.seed);
    this.backdrop = this.makeBackdrop(col.seed);
    this.snowTex = makeSnowCanvas(col.seed);
    this.leafTex = makeLeafCanvas(col.seed);
    this.mound = makeCanvas(W * TEX, SURF_D * TEX);
    this.pherCanvas = makeCanvas(PCOLS, PROWS);
    this.rebuildMound();
    this.outlineVersion = -1;
    col.fx.length = 0;
  }

  // ---------------------------------------------------------------- camera
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = Math.max(1, r.width); this.vh = Math.max(1, r.height);
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
  }

  get minZoom() { return Math.min(this.vw / (W + 80), this.vh / (SOIL_H - TOP + 60)) * 0.9; }

  // Default framing: the ground around the entrance and the nest below it.
  fit(whole = false) {
    this.target = null;
    if (whole) {
      const zoom = Math.min(this.vw / (W + 40), (this.vh - 120) / (SOIL_H - TOP + 20));
      this.cam = { x: W / 2, y: (TOP + SOIL_H) / 2 + 20 / zoom, zoom: Math.max(this.minZoom, zoom) };
      return;
    }
    const nestBottom = this.col ? Math.max(this.col.nest.depth + 110, 300) : 300;
    const top = -PLANE_H - 50, bottom = Math.min(SOIL_H, nestBottom);
    const zoom = clamp(Math.min(this.vw / (this.vw < 700 ? 430 : 820), (this.vh - 130) / (bottom - top)), this.minZoom, 3);
    let x = ENTRANCE.x;
    if (this.col) { const b = this.col.nest.bounds; x = clamp(((b.c0 + b.c1) / 2) * 4, ENTRANCE.x - 200, ENTRANCE.x + 200); }
    this.cam = { x, y: (top + bottom) / 2 + 15 / zoom, zoom };
    this.clampCam();
  }

  clampCam() {
    const c = this.cam;
    c.zoom = clamp(c.zoom, this.minZoom, 7);
    const hw = this.vw / 2 / c.zoom, hh = this.vh / 2 / c.zoom;
    const minX = Math.min(W / 2, hw - 40), maxX = Math.max(W / 2, W - hw + 40);
    c.x = clamp(c.x, minX, maxX);
    const minY = Math.min((TOP + SOIL_H) / 2, TOP + hh - 40), maxY = Math.max((TOP + SOIL_H) / 2, SOIL_H - hh + 40);
    c.y = clamp(c.y, minY, maxY);
  }

  toWorld(sx, sy) {
    const c = this.cam;
    return { x: (sx - this.vw / 2) / c.zoom + c.x, y: (sy - this.vh / 2) / c.zoom + c.y };
  }
  toScreen(x, y) {
    const c = this.cam;
    return { x: (x - c.x) * c.zoom + this.vw / 2, y: (y - c.y) * c.zoom + this.vh / 2 };
  }
  zoomAt(sx, sy, factor) {
    const before = this.toWorld(sx, sy);
    this.cam.zoom = clamp(this.cam.zoom * factor, this.minZoom, 7);
    const after = this.toWorld(sx, sy);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
    this.clampCam();
  }
  pan(dx, dy) { this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom; this.clampCam(); }

  // Plane point under a screen position, or null when not on the ground.
  pickPlane(sx, sy) {
    const p = this.toWorld(sx, sy);
    if (p.y > 2 || p.y < -PLANE_H || p.x < 0 || p.x > W) return null;
    return { x: p.x, z: clamp(-p.y / FORE, 0, SURF_D) };
  }

  antPos(a) {
    if (a.loc === 'air') return { x: a.x, y: -a.z * FORE - a.alt };
    if (a.loc === 'surface') return { x: a.x, y: -a.z * FORE - this.col.surface.height(a.x, a.z) };
    return { x: a.x, y: a.y };
  }

  pickAnt(sx, sy) {
    const p = this.toWorld(sx, sy);
    let best = null, bd = 9 / this.cam.zoom + 5;
    for (const a of this.col.ants) {
      const q = this.antPos(a);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  follow(ant) { this.target = ant ? ant.id : null; }

  // ---------------------------------------------------------------- caches
  makeBackdrop(seed) {
    const rng = new Rng(seed ^ 0xbacd);
    const hills = [0, 1, 2].map(layer => {
      const pts = [];
      const base = -PLANE_H - 8 - layer * 14 - rng.range(0, 10);
      const ph = rng.next() * 6;
      for (let x = -20; x <= W + 20; x += 20) pts.push([x, base - 10 - Math.sin(x * 0.003 * (layer + 1) + ph) * (9 - layer * 2) - Math.sin(x * 0.011 + ph * 2) * 3]);
      return { pts, layer };
    });
    const blades = [];
    for (let i = 0; i < 46; i++) {
      blades.push({ x: rng.range(-10, W + 10), h: rng.range(50, SKY_H + 30), lean: rng.range(-0.35, 0.35), w: rng.range(4, 10), tone: rng.next() });
    }
    const stars = Array.from({ length: 70 }, () => ({ x: rng.range(0, W), y: TOP + rng.range(2, SKY_H * 0.8), r: rng.range(0.4, 1.2), tw: rng.range(0, 6) }));
    return { hills, blades, stars };
  }

  rebuildMound() {
    const ctx = this.mound.getContext('2d');
    ctx.clearRect(0, 0, this.mound.width, this.mound.height);
    const rng = new Rng(this.col.seed ^ 0x3333);
    const m = this.col.surface.mound;
    const list = [];
    for (let r = 0; r < MROWS; r++) for (let c = 0; c < MCOLS; c++) {
      const h = m[r * MCOLS + c];
      if (h < 0.35) continue;
      const n = Math.ceil(h * 0.9);
      for (let k = 0; k < n; k++) {
        list.push({ x: (c + rng.next()) * MG, z: (r + rng.next()) * MG, h: h * (k + 1) / n - 0.6, s: rng.pick([1, 2, 2, 2, 3, 3, 4, 5]) });
      }
    }
    list.sort((a, b) => b.z - a.z);
    for (const g of list) this.drawGrain(ctx, g.x, g.z, g.h, g.s, rng);
    const mid = this.col.surface.midden;
    for (let k = 0; k < Math.min(mid, 200); k++) {
      this.drawMiddenAnt(ctx, MIDDEN.x + rng.gauss() * 10, MIDDEN.z + rng.gauss() * 6, rng.range(0, TAU));
    }
  }

  drawGrain(ctx, x, z, h, s, rng = null) {
    const r = 1.4 + (rng ? rng.next() : Math.random()) * 0.9;
    const px = x * TEX, py = (SURF_D - z - Math.max(0, h) / FORE) * TEX;
    const rx = r * TEX, ry = r * TEX / FORE;
    ctx.fillStyle = 'rgba(25,15,8,0.35)';
    ctx.beginPath(); ctx.ellipse(px + rx * 0.3, py + ry * 0.35, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = PELLET_COLORS[s] || PELLET_COLORS[2];
    ctx.beginPath(); ctx.ellipse(px, py, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,220,0.22)';
    ctx.beginPath(); ctx.ellipse(px - rx * 0.3, py - ry * 0.35, rx * 0.45, ry * 0.4, 0, 0, TAU); ctx.fill();
  }

  drawMiddenAnt(ctx, x, z, rot) {
    ctx.save();
    ctx.translate(x * TEX, (SURF_D - z) * TEX);
    ctx.scale(TEX, TEX * ANT_SQ / FORE);
    ctx.rotate(rot);
    drawAnt(ctx, { caste: 'worker', size: 0.95, gait: 0 }, 1, 0, { dead: true });
    ctx.restore();
  }

  consumeFx() {
    const col = this.col, ctx = this.mound.getContext('2d');
    for (const e of col.fx) {
      if (e.k === 'grain') {
        for (let k = 0; k < 3; k++) this.drawGrain(ctx, e.x + (Math.random() - 0.5) * 4, e.z + (Math.random() - 0.5) * 3, e.h + Math.random() * 0.8, e.s);
      } else if (e.k === 'corpse') {
        this.drawMiddenAnt(ctx, e.x, e.z, e.h || 0);
      } else if (e.k === 'dig') {
        for (let k = 0; k < 5; k++) {
          this.particles.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 18, vy: -Math.random() * 10, life: 0.7, c: PELLET_COLORS[e.s] });
        }
      }
    }
    col.fx.length = 0;
  }

  // ---------------------------------------------------------------- frame
  draw(realDt) {
    const col = this.col;
    if (!col) return;
    this.time += realDt;
    this.consumeFx();
    if (this.target !== null) {
      const a = col.ants.find(q => q.id === this.target);
      if (!a) this.target = null;
      else {
        const p = this.antPos(a), k = 1 - Math.exp(-realDt * 4);
        this.cam.x += (p.x - this.cam.x) * k; this.cam.y += (p.y - this.cam.y) * k;
        this.clampCam();
      }
    }
    if (this.outlineVersion !== col.nest.version && (this.time - this.outlineTime > 0.12 || this.outlineVersion < 0)) {
      this.outline = buildNestOutline(col.nest);
      this.outlineVersion = col.nest.version; this.outlineTime = this.time;
    }
    const ctx = this.ctx, c = this.cam, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#16130f';
    ctx.fillRect(0, 0, this.vw, this.vh);
    const z = c.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.vw / 2 - c.x * z), dpr * (this.vh / 2 - c.y * z));
    this.view = { x0: c.x - this.vw / 2 / z, x1: c.x + this.vw / 2 / z, y0: c.y - this.vh / 2 / z, y1: c.y + this.vh / 2 / z };

    // Diorama block shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 40 * z * dpr; ctx.shadowOffsetY = 12 * z * dpr;
    ctx.fillStyle = '#2a2018';
    ctx.fillRect(0, TOP, W, SOIL_H - TOP);
    ctx.restore();

    const tod = col.timeOfDay, light = col.light;
    const autumn = clamp(1 - Math.abs(col.yearFrac - 0.64) / 0.14);
    const snow = clamp((col.cold - 0.45) / 0.35);
    this.season = { dry: Math.max(autumn * 0.75, clamp(col.cold * 1.3)), bloom: col.yearFrac < 0.5 && col.cold < 0.05, snow, autumn };
    this.drawSky(ctx, tod, light);
    ctx.drawImage(this.groundTex, 0, -PLANE_H, W, PLANE_H);
    if (autumn > 0.02) { ctx.globalAlpha = autumn; ctx.drawImage(this.leafTex, 0, -PLANE_H, W, PLANE_H); ctx.globalAlpha = 1; }
    ctx.drawImage(this.mound, 0, -PLANE_H, W, PLANE_H);
    if (snow > 0.02) { ctx.globalAlpha = snow * 0.92; ctx.drawImage(this.snowTex, 0, -PLANE_H, W, PLANE_H); ctx.globalAlpha = 1; }
    if (this.showPheromone) this.drawPheromone(ctx);
    this.drawEntrance(ctx);
    if (col.surface.wings) this.drawWings(ctx, col.surface.wings);

    if (this.view.y1 > 0) this.drawSection(ctx, light);
    this.drawSurfaceObjects(ctx, light);
    this.drawFlyers(ctx);
    // Night falls over the meadow (the section is lit for observation)
    if (light < 0.98) {
      ctx.fillStyle = `rgba(14,22,52,${(1 - light) * 0.5})`;
      ctx.fillRect(0, TOP, W, -TOP);
    }
    this.drawParticles(ctx, realDt);
    // Lip between the ground and the cut face
    ctx.fillStyle = 'rgba(255,240,210,0.16)'; ctx.fillRect(0, -0.6, W, 1.2);
    if (this.ghost) this.drawGhost(ctx);
    if (this.selected) this.drawSelection(ctx);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawOverlayText(ctx);
  }

  drawSky(ctx, tod, light) {
    const [top0, bottom0] = skyAt(tod);
    const grey = (this.season?.snow || 0) * 0.35;
    const top = top0.map(v => v + (150 - v) * grey), bottom = bottom0.map(v => v + (200 - v) * grey);
    const g = ctx.createLinearGradient(0, TOP, 0, -PLANE_H);
    g.addColorStop(0, css(top)); g.addColorStop(1, css(bottom));
    ctx.fillStyle = g; ctx.fillRect(0, TOP, W, SKY_H + 1);
    const night = 1 - light;
    if (night > 0.3) {
      for (const s of this.backdrop.stars) {
        ctx.fillStyle = `rgba(255,255,240,${(night - 0.3) * (0.6 + 0.4 * Math.sin(this.time * 2 + s.tw))})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      }
    }
    // Sun / moon on an arc
    const dayT = (tod - 0.22) / 0.6;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, TOP, W, SKY_H); ctx.clip();
    if (dayT > -0.05 && dayT < 1.05) {
      const sx = W * (0.1 + dayT * 0.8), sy = -PLANE_H - Math.sin(clamp(dayT) * Math.PI) * SKY_H * 0.8 + 6;
      const halo = ctx.createRadialGradient(sx, sy, 2, sx, sy, 60);
      halo.addColorStop(0, 'rgba(255,245,210,0.7)'); halo.addColorStop(1, 'rgba(255,245,210,0)');
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sx, sy, 60, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff6dc'; ctx.beginPath(); ctx.arc(sx, sy, 11, 0, TAU); ctx.fill();
    } else {
      const nt = ((tod + 0.18) % 1) / 0.4;
      const mx = W * (0.15 + nt * 0.7), my = -PLANE_H - Math.sin(clamp(nt) * Math.PI) * SKY_H * 0.7 + 4;
      ctx.fillStyle = 'rgba(240,240,225,0.9)'; ctx.beginPath(); ctx.arc(mx, my, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = css(top); ctx.beginPath(); ctx.arc(mx + 3.5, my - 2, 7, 0, TAU); ctx.fill();
    }
    // Distant hills and towering grass
    for (const h of this.backdrop.hills) {
      const k = 0.55 + light * 0.45, haze = 0.45 - h.layer * 0.12;
      const dry = this.season?.dry || 0, white = (this.season?.snow || 0) * 0.75;
      const base = [96 - h.layer * 8, 122 - h.layer * 10, 84 - h.layer * 6].map((v, i) => v + ([150, 128, 84][i] - v) * dry * 0.7).map(v => v + (228 - v) * white);
      const col = base.map((v, i) => (v * (1 - haze) + bottom[i] * haze) * k);
      ctx.fillStyle = css(col);
      ctx.beginPath(); ctx.moveTo(-20, -PLANE_H + 1);
      for (const [x, y] of h.pts) ctx.lineTo(x, y);
      ctx.lineTo(W + 20, -PLANE_H + 1); ctx.closePath(); ctx.fill();
    }
    const wind = Math.sin(this.time * 0.6) * 0.04;
    for (const b of this.backdrop.blades) {
      const k = (0.45 + light * 0.4) * (0.8 + b.tone * 0.3);
      ctx.fillStyle = leafRGB(74, 104, 56, this.season?.dry || 0, k);
      const bx = b.x, by = -PLANE_H + 2, tip = bx + (b.lean + wind) * b.h;
      ctx.beginPath(); ctx.moveTo(bx - b.w / 2, by);
      ctx.quadraticCurveTo(bx + b.lean * b.h * 0.3, by - b.h * 0.6, tip, by - b.h);
      ctx.quadraticCurveTo(bx + b.lean * b.h * 0.3 + b.w * 0.25, by - b.h * 0.5, bx + b.w / 2, by);
      ctx.fill();
    }
    ctx.restore();
  }

  drawPheromone(ctx) {
    if (this.time - this.pherTime > 0.2) {
      this.pherTime = this.time;
      const p = this.col.surface.pher, pc = this.pherCanvas.getContext('2d');
      const img = pc.createImageData(PCOLS, PROWS), d = img.data;
      for (let r = 0; r < PROWS; r++) for (let c = 0; c < PCOLS; c++) {
        const v = p[r * PCOLS + c];
        const o = ((PROWS - 1 - r) * PCOLS + c) * 4;
        d[o] = 120; d[o + 1] = 225; d[o + 2] = 255;
        d[o + 3] = v > 0.01 ? Math.min(220, Math.pow(v / 1.6, 0.6) * 220) : 0;
      }
      pc.putImageData(img, 0, 0);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(this.pherCanvas, 0, -PROWS * PG * FORE, W, PROWS * PG * FORE);
    ctx.restore();
  }

  drawEntrance(ctx) {
    const col = this.col;
    if (!col.nest.isOpen(col.nest.entranceCell)) return;
    const x = ENTRANCE.x, y = -ENTRANCE.z * FORE - col.surface.height(x, ENTRANCE.z);
    const g = ctx.createRadialGradient(x, y, 0.5, x, y, 7);
    g.addColorStop(0, 'rgba(8,4,2,1)'); g.addColorStop(0.6, 'rgba(30,18,10,0.9)'); g.addColorStop(1, 'rgba(60,40,25,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, 7.5, 3.6, 0, 0, TAU); ctx.fill();
  }

  drawWings(ctx, w) {
    const x = w.x, y = -w.z * FORE;
    ctx.save(); ctx.translate(x, y); ctx.scale(1, ANT_SQ); ctx.rotate(-w.rot);
    ctx.fillStyle = 'rgba(235,238,242,0.55)'; ctx.strokeStyle = 'rgba(110,110,120,0.6)'; ctx.lineWidth = 0.2;
    for (const [dx, dy, rot] of [[-4, 4, 0.5], [3, 6, -0.3], [8, -3, 1.2], [-2, -6, 2.4]]) {
      ctx.beginPath(); ctx.ellipse(dx, dy, 7.5, 2, rot, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- section
  drawSection(ctx, light) {
    const col = this.col, nest = col.nest;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, SOIL_H); ctx.clip();
    ctx.drawImage(this.soilTex, 0, 0, W, SOIL_H);
    this.drawNestLayer(ctx);
    this.drawStores(ctx);
    this.drawBrood(ctx);
    for (const c of col.corpses) if (c.loc === 'nest') {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.h || 0);
      drawAnt(ctx, { caste: c.queen ? 'queen' : 'worker', size: 1, gait: 0 }, 0, 0, { dead: true });
      ctx.restore();
    }
    const lod = this.lod();
    const v = this.view;
    for (const a of col.ants) {
      if (a.loc !== 'nest') continue;
      if (a.x < v.x0 - 10 || a.x > v.x1 + 10 || a.y < v.y0 - 10 || a.y > v.y1 + 10) continue;
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.h);
      drawAnt(ctx, a, a.caste === 'worker' ? lod : Math.max(0, lod - 1), this.time, { digging: a.task === 'dig' && a.st === 'dig' });
      ctx.restore();
    }
    // Glass sheen over the cut face
    const sheen = ctx.createLinearGradient(0, 0, W * 0.6, SOIL_H);
    sheen.addColorStop(0, 'rgba(255,255,255,0.05)'); sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.55, 'rgba(255,255,255,0.035)'); sheen.addColorStop(0.62, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, W, SOIL_H);
    if (light < 0.9) { ctx.fillStyle = `rgba(10,15,35,${(1 - light) * 0.14})`; ctx.fillRect(0, 0, W, SOIL_H); }
    ctx.restore();
  }

  // Cavities are vector art; render them into a cached bitmap at the current zoom
  // and refresh only when the nest changes, the zoom bucket changes or damp soil fades.
  drawNestLayer(ctx) {
    const col = this.col, nest = col.nest;
    if (!this.outline) return;
    const scale = Math.min(4, Math.max(1, Math.ceil(this.cam.zoom * this.dpr * 1.25)));
    const b = nest.bounds;
    const x0 = Math.max(0, b.c0 * 4 - 24), x1 = Math.min(W, (b.c1 + 1) * 4 + 24);
    const y0 = 0, y1 = Math.min(SOIL_H, (b.r1 + 1) * 4 + 24);
    const fit = Math.min(scale, 4096 / (x1 - x0), 4096 / (y1 - y0));
    const L = this.layer;
    const damp = nest.recent.length && col.time - nest.recent[nest.recent.length - 1].t < 50;
    const stale = !L || L.version !== this.outlineVersion || L.scale !== fit || L.x0 !== x0 || L.x1 !== x1 || L.y1 !== y1 ||
      (damp && this.time - L.time > 1.2) || (!damp && L.damp);
    if (stale) {
      const c = L && L.canvas.width === Math.ceil((x1 - x0) * fit) && L.canvas.height === Math.ceil((y1 - y0) * fit) ? L.canvas : makeCanvas((x1 - x0) * fit, (y1 - y0) * fit);
      const g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
      g.setTransform(fit, 0, 0, fit, -x0 * fit, -y0 * fit);
      this.paintCavities(g, damp);
      this.layer = { canvas: c, scale: fit, version: this.outlineVersion, x0, x1, y0, y1, time: this.time, damp };
    }
    const lay = this.layer;
    ctx.drawImage(lay.canvas, lay.x0, lay.y0, lay.x1 - lay.x0, lay.y1 - lay.y0);
  }

  paintCavities(ctx, damp) {
    const col = this.col, nest = col.nest, path = this.outline.path;
    if (damp) {
      // Freshly dug soil is darker (damp) for a while.
      for (const r of nest.recent) {
        const age = col.time - r.t;
        if (age > 50) continue;
        ctx.fillStyle = `rgba(28,16,8,${0.32 * (1 - age / 50)})`;
        ctx.beginPath(); ctx.arc(cx(r.i), cy(r.i), 7, 0, TAU); ctx.fill();
      }
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(32,20,12,0.45)'; ctx.lineWidth = 2.6; ctx.stroke(path);
    ctx.fillStyle = ctx.createPattern(this.cavityTile, 'repeat'); ctx.fill(path, 'evenodd');
    ctx.save();
    ctx.clip(path, 'evenodd');
    const shade = ctx.createLinearGradient(0, 0, 0, SOIL_H);
    shade.addColorStop(0, 'rgba(255,248,230,0.12)'); shade.addColorStop(1, 'rgba(90,60,30,0.18)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, SOIL_H);
    ctx.translate(0, 2.2);
    ctx.strokeStyle = 'rgba(70,42,20,0.28)'; ctx.lineWidth = 5; ctx.stroke(path);
    ctx.translate(0, -2.2);
    ctx.strokeStyle = 'rgba(80,50,25,0.3)'; ctx.lineWidth = 2.2; ctx.stroke(path);
    ctx.restore();
    ctx.strokeStyle = 'rgba(40,24,12,0.65)'; ctx.lineWidth = 0.7; ctx.stroke(path);
  }

  lod() {
    const len = 9 * this.cam.zoom;
    return len < 4.5 ? 2 : len < 10 ? 1 : 0;
  }

  drawBrood(ctx) {
    const col = this.col;
    const rooms = col.broodRooms();
    const ids = new Set(rooms.map(r => r.id));
    for (const b of col.brood) if (!b.carried && !ids.has(b.room)) { const f = col.nest.feature(b.room); if (f && !rooms.includes(f)) rooms.push(f); ids.add(b.room); }
    for (const room of rooms) {
      const layout = col.layoutRoom(room);
      for (const b of col.brood) {
        if (b.room !== room.id || b.carried) continue;
        const p = layout.get(b.id);
        if (!p) continue;
        const k = b.caste === 'gyne' ? 1.45 : b.caste === 'male' ? 1.15 : 1;
        if (b.stage === 'egg') drawEgg(ctx, p.x, p.y, b.slot * 3);
        else if (b.stage === 'larva') drawLarva(ctx, p.x, p.y - 0.4 * k, b.p, (b.slot - 0.5) * 0.8 + (b.slot > 0.5 ? Math.PI : 0), b.food <= 0.05, k);
        else drawPupa(ctx, p.x, p.y - 0.2 - (k - 1) * 1.5, b.p, 0.95 * k, Math.PI / 2 + (b.slot - 0.5) * 0.2);
      }
    }
  }

  // Seeds, prey pieces and honey drops piled on the floor of food rooms.
  drawStores(ctx) {
    const col = this.col, s = col.stores;
    let rooms = col.nest.rooms('food').filter(f => f.done);
    if (!rooms.length) { const r = col.nest.room('royal'); rooms = r ? [r] : []; }
    if (!rooms.length) return;
    const counts = { seed: Math.min(90, Math.floor(s.seeds)), meat: Math.min(60, Math.floor(s.protein)), honey: Math.min(30, Math.floor(s.sugar / 3)) };
    const key = `${counts.seed}:${counts.meat}:${counts.honey}:${col.nest.version}:${rooms.map(r => r.id).join(',')}`;
    if (this.storeKey !== key) {
      this.storeKey = key;
      const items = [];
      const rng = new Rng(17);
      const spans = rooms.map(r => ({ r, span: col.nest.roomSpan(r) }));
      const place = (kind, n, zone) => {
        for (let k = 0; k < n; k++) {
          const { r, span } = spans[k % spans.length];
          const w = span.x1 - span.x0;
          const x = span.x0 + 6 + (zone + rng.next() * 0.33) * (w - 12);
          const stack = Math.floor(k / spans.length / 10);
          items.push({ kind, x, y: col.nest.floorY(x, r) - 1.3 - stack * 1.6 - rng.next(), rot: rng.range(0, TAU), tone: rng.next() });
        }
      };
      place('seed', counts.seed, 0.0); place('meat', counts.meat, 0.66); place('honey', counts.honey, 0.33);
      this.storeItems = items;
    }
    for (const it of this.storeItems) {
      if (it.kind === 'seed') drawSeed(ctx, it.x, it.y, it.rot * 0.2, it.tone, 0.85);
      else if (it.kind === 'meat') {
        ctx.fillStyle = it.tone > 0.5 ? '#7d4326' : '#93542f';
        ctx.beginPath(); ctx.ellipse(it.x, it.y, 1.9, 1.2, it.rot, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(222,150,40,0.88)';
        ctx.beginPath(); ctx.ellipse(it.x, it.y - 0.3, 1.8, 1.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,250,220,0.7)';
        ctx.beginPath(); ctx.arc(it.x - 0.6, it.y - 0.9, 0.45, 0, TAU); ctx.fill();
      }
    }
  }

  // ---------------------------------------------------------------- surface
  drawSurfaceObjects(ctx, light) {
    const col = this.col, s = col.surface;
    const items = [];
    for (const p of this.flora) items.push({ z: p.z, k: 0, p });
    for (const o of s.obstacles) items.push({ z: o.z, k: 1, o });
    for (const f of s.foods) items.push({ z: f.z + 0.5, k: 2, f });
    for (const a of col.ants) if (a.loc === 'surface') items.push({ z: a.z, k: 3, a });
    for (const c of col.corpses) if (c.loc === 'surface') items.push({ z: c.z, k: 4, c });
    items.sort((p, q) => q.z - p.z);
    const lod = this.lod();
    const v = this.view;
    for (const it of items) {
      if (it.k === 0) {
        const p = it.p, y = -p.z * FORE;
        if (p.x < v.x0 - 40 || p.x > v.x1 + 40) continue;
        ctx.save(); ctx.translate(p.x, y); drawPlant(ctx, p, this.time, light, this.season); ctx.restore();
      } else if (it.k === 1) {
        const o = it.o;
        ctx.save(); ctx.translate(o.x, -o.z * FORE); drawStone(ctx, o, FORE); ctx.restore();
      } else if (it.k === 2) {
        const f = it.f, y = -f.z * FORE - s.height(f.x, f.z);
        ctx.save(); ctx.translate(f.x, y); drawFood(ctx, f, FOODS[f.type], this.time, FORE + 0.08); ctx.restore();
      } else if (it.k === 3) {
        const a = it.a;
        const y = -a.z * FORE - s.height(a.x, a.z);
        if (a.x < v.x0 - 10 || a.x > v.x1 + 10 || y < v.y0 - 10 || y > v.y1 + 10) continue;
        ctx.save(); ctx.translate(a.x, y);
        if (lod === 0) {
          ctx.fillStyle = 'rgba(20,12,5,0.18)';
          ctx.beginPath(); ctx.ellipse(1.2, 1.4, 5.5 * (a.caste === 'queen' ? 1.5 : 1), 2, 0, 0, TAU); ctx.fill();
        }
        ctx.scale(1, ANT_SQ); ctx.rotate(-a.h);
        drawAnt(ctx, a, a.caste === 'worker' ? lod : Math.max(0, lod - 1), this.time, { harvest: a.st === 'harvest', digging: a.st === 'dig', flap: a.st === 'wing' && Math.sin(this.time * 3 + a.id) > 0.3 ? this.time : 0 });
        ctx.restore();
      } else {
        const c = it.c;
        ctx.save(); ctx.translate(c.x, -c.z * FORE); ctx.scale(1, ANT_SQ); ctx.rotate(-(c.h || 0));
        drawAnt(ctx, { caste: c.queen ? 'queen' : 'worker', size: 1, gait: 0 }, lod, 0, { dead: true });
        ctx.restore();
      }
    }
  }

  // Winged ants rising from the mound during the nuptial flight.
  drawFlyers(ctx) {
    const lod = Math.max(0, this.lod() - 1);
    for (const a of this.col.ants) {
      if (a.loc !== 'air') continue;
      const gy = -a.z * FORE;
      ctx.fillStyle = `rgba(20,12,5,${0.2 * clamp(1 - a.alt / 60)})`;
      ctx.beginPath(); ctx.ellipse(a.x, gy, 4, 1.5, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(a.x, gy - a.alt);
      const k = 1 + Math.min(0.6, a.alt / 400);
      ctx.scale(k, k * 0.8); ctx.rotate(-a.h);
      drawAnt(ctx, a, lod, this.time, { flap: this.time + a.id });
      ctx.restore();
    }
  }

  drawParticles(ctx, dt) {
    const ps = this.particles;
    for (const p of ps) {
      p.life -= dt; p.vy += 40 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.fillStyle = p.c; ctx.globalAlpha = clamp(p.life / 0.7);
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.7, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.particles = ps.filter(p => p.life > 0);
  }

  drawGhost(ctx) {
    const g = this.ghost, y = -g.z * FORE - this.col.surface.height(g.x, g.z);
    ctx.save(); ctx.translate(g.x, y);
    ctx.globalAlpha = g.ok ? 0.75 : 0.3;
    const spec = FOODS[g.type];
    drawFood(ctx, { type: g.type, amount: spec.amount, max: spec.amount, rot: 0.4, seed: 5 }, spec, this.time, FORE + 0.08);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = g.ok ? 'rgba(255,255,255,0.8)' : 'rgba(255,120,100,0.9)';
    ctx.setLineDash([2, 2]); ctx.lineWidth = 0.8 / Math.max(0.6, this.cam.zoom) * 1.4;
    ctx.beginPath(); ctx.ellipse(0, 0, spec.radius + 6, (spec.radius + 6) * FORE, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  drawSelection(ctx) {
    const a = this.col.ants.find(q => q.id === this.selected);
    if (!a) { this.selected = null; return; }
    const p = this.antPos(a), r = a.caste === 'queen' ? 13 : 9;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,250,235,0.95)'; ctx.lineWidth = 1.6 / this.cam.zoom + 0.3;
    ctx.setLineDash([3, 2.4]); ctx.lineDashOffset = -this.time * 6;
    ctx.beginPath();
    if (a.loc === 'surface') ctx.ellipse(p.x, p.y, r, r * 0.65, 0, 0, TAU); else ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // Screen-space labels: rooms and the depth ruler.
  drawOverlayText(ctx) {
    const col = this.col, z = this.cam.zoom;
    ctx.font = '600 11px "Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (this.showLabels && z > 0.8) {
      ctx.font = '600 10.5px "Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif';
      for (const room of col.nest.chambers) {
        if (!room.started) continue;
        if (room._spanV !== col.nest.version) { room._span = col.nest.roomSpan(room); room._spanV = col.nest.version; }
        const side = room.side || 1, span = room._span;
        if (span.empty) continue;
        const edge = room.done ? (side > 0 ? Math.max(span.x1, room.x) + 7 : Math.min(span.x0, room.x) - 7) : (side > 0 ? span.x1 + 7 : span.x0 - 7);
        const p = this.toScreen(edge, room.y);
        if (p.x < -80 || p.x > this.vw + 80 || p.y < -20 || p.y > this.vh + 20) continue;
        const text = ROLE_NAMES[room.role] || '';
        const w = ctx.measureText(text).width + 12;
        const x0 = side > 0 ? p.x : p.x - w;
        ctx.fillStyle = room.role === 'dig' ? 'rgba(60,40,20,0.5)' : 'rgba(22,16,11,0.6)';
        roundRect(ctx, x0, p.y - 8, w, 16, 8); ctx.fill();
        ctx.fillStyle = room.role === 'royal' ? '#f5d58a' : room.role === 'dig' ? '#e9cfa6' : '#f3eadb';
        ctx.fillText(text, x0 + w / 2, p.y + 0.5);
      }
    }
    // Depth ruler
    const top = this.toScreen(0, 0);
    if (top.y < this.vh) {
      ctx.textAlign = 'left';
      ctx.font = '500 10px "Hiragino Sans","Noto Sans JP",sans-serif';
      const x0 = Math.max(4, this.toScreen(0, 0).x + 4);
      for (let cm = 1; cm * PX_PER_CM < SOIL_H; cm++) {
        const p = this.toScreen(0, cm * PX_PER_CM);
        if (p.y < 0 || p.y > this.vh) continue;
        const major = cm % 5 === 0;
        if (!major && z < 0.9) continue;
        ctx.fillStyle = major ? 'rgba(255,245,225,0.7)' : 'rgba(255,245,225,0.35)';
        ctx.fillRect(x0, p.y, major ? 10 : 5, 1);
        if (major) ctx.fillText(`${cm}cm`, x0 + 13, p.y + 0.5);
      }
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

