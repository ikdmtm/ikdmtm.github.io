// Pre-rendered textures for the soil cross-section and the ground plane.
import { W, SOIL_H, SURF_D, ENTRANCE } from '../sim/config.js';
import { Rng } from '../sim/rng.js';

export const SOIL_COLORS = [null, [74, 53, 38], [107, 76, 52], [142, 95, 61], [169, 138, 99], [125, 102, 80]];
export const PELLET_COLORS = [null, '#4f3a2a', '#73533a', '#9a6843', '#b89670', '#86705a'];

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

const rgb = (c, k = 1, a = 1) => `rgba(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)},${a})`;

// Low-frequency mottling: random blobs on a small canvas, scaled up smoothly.
function mottle(ctx, rng, w, h, scale, alpha, count) {
  const small = makeCanvas(w / 16, h / 16), s = small.getContext('2d');
  for (let i = 0; i < count; i++) {
    const light = rng.chance(0.5);
    s.fillStyle = light ? `rgba(255,240,215,${rng.range(0.03, 0.08)})` : `rgba(30,18,8,${rng.range(0.03, 0.1)})`;
    s.beginPath();
    s.ellipse(rng.range(0, small.width), rng.range(0, small.height), rng.range(0.6, 3.5), rng.range(0.4, 1.6), rng.range(-0.3, 0.3), 0, Math.PI * 2);
    s.fill();
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, w * scale, h * scale);
  ctx.restore();
}

function grain(ctx, rng, cw, ch, amount) {
  const img = ctx.getImageData(0, 0, cw, ch), d = img.data;
  let s = rng.int(1e9) | 1;
  for (let i = 0; i < d.length; i += 4) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const n = ((s & 255) / 255 - 0.5) * amount;
    d[i] += n; d[i + 1] += n * 0.92; d[i + 2] += n * 0.8;
  }
  ctx.putImageData(img, 0, 0);
}

export function makeSoilCanvas(soil, seed, scale = 2) {
  const rng = new Rng(seed ^ 0xbeef);
  const cw = W * scale, ch = SOIL_H * scale;
  const canvas = makeCanvas(cw, ch), ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  // Strata, deepest first, each with a soft transition band.
  ctx.fillStyle = rgb(SOIL_COLORS[5]);
  ctx.fillRect(0, 0, W, SOIL_H);
  for (let k = soil.strata.length - 1; k >= 0; k--) {
    const line = soil.strata[k], color = SOIL_COLORS[k + 1];
    for (let pass = 0; pass < 3; pass++) {
      ctx.fillStyle = rgb(color, 1, pass === 2 ? 1 : 0.35);
      ctx.beginPath(); ctx.moveTo(0, 0);
      line.forEach((y, c) => ctx.lineTo(c * 4, y + (2 - pass) * 4));
      ctx.lineTo(W, 0); ctx.closePath(); ctx.fill();
    }
  }
  // Subtle vertical darkening with depth.
  const depth = ctx.createLinearGradient(0, 0, 0, SOIL_H);
  depth.addColorStop(0, 'rgba(0,0,0,0)'); depth.addColorStop(1, 'rgba(20,10,4,0.28)');
  ctx.fillStyle = depth; ctx.fillRect(0, 0, W, SOIL_H);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  mottle(ctx, rng, cw, ch, 1, 1, 900);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // Fine sediment lines following the strata.
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 70; i++) {
    const k = rng.int(soil.strata.length), off = rng.range(8, 120) * (rng.chance(0.5) ? 1 : -1);
    const x0 = rng.range(-50, W), len = rng.range(60, 300);
    ctx.strokeStyle = rng.chance(0.5) ? 'rgba(255,235,200,0.06)' : 'rgba(25,14,6,0.1)';
    ctx.beginPath();
    for (let x = x0; x < x0 + len; x += 8) {
      const c = Math.max(0, Math.min(soil.strata[k].length - 1, Math.round(x / 4)));
      const y = soil.strata[k][c] + off + Math.sin(x * 0.05) * 1.5;
      if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Speckles: sand grains, tiny pebbles, organic bits.
  for (let i = 0; i < 9000; i++) {
    const x = rng.range(0, W), y = rng.range(0, SOIL_H);
    const r = rng.chance(0.92) ? rng.range(0.3, 0.9) : rng.range(1, 2.4);
    const light = rng.chance(0.55);
    const deep = y / SOIL_H;
    ctx.fillStyle = light ? `rgba(${230 - deep * 20},${205 - deep * 20},${165},${rng.range(0.12, 0.4)})` : `rgba(20,12,6,${rng.range(0.15, 0.45)})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * rng.range(0.6, 1), rng.range(0, 3), 0, Math.PI * 2); ctx.fill();
    if (r > 1.4) {
      ctx.fillStyle = 'rgba(255,245,225,0.25)';
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Roots
  for (const root of soil.roots) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 1; i < root.pts.length; i++) {
      const a = root.pts[i - 1], b = root.pts[i], t = i / root.pts.length;
      ctx.strokeStyle = 'rgba(48,30,18,0.75)';
      ctx.lineWidth = root.w * (1 - t * 0.8) + 0.4;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(160,120,80,0.35)';
      ctx.lineWidth = Math.max(0.3, root.w * (1 - t * 0.8) * 0.35);
      ctx.beginPath(); ctx.moveTo(a.x - 0.3, a.y); ctx.lineTo(b.x - 0.3, b.y); ctx.stroke();
      if (rng.chance(0.25)) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x) + rng.sign() * rng.range(0.5, 1.2), l = rng.range(4, 14);
        ctx.strokeStyle = 'rgba(48,30,18,0.5)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.quadraticCurveTo(b.x + Math.cos(ang) * l * 0.6, b.y + Math.sin(ang) * l * 0.6 + 2, b.x + Math.cos(ang) * l, b.y + Math.sin(ang) * l + 3); ctx.stroke();
      }
    }
  }
  // Rocks
  for (const rock of soil.rocks) drawRock(ctx, rock, rng);
  // Turf mat along the top edge.
  const turf = ctx.createLinearGradient(0, 0, 0, 14);
  turf.addColorStop(0, 'rgba(35,26,16,0.85)'); turf.addColorStop(1, 'rgba(35,26,16,0)');
  ctx.fillStyle = turf; ctx.fillRect(0, 0, W, 14);
  for (let i = 0; i < 1400; i++) {
    const x = rng.range(0, W), l = rng.range(2, 9);
    if (Math.abs(x - ENTRANCE.x) < 10) continue;
    ctx.strokeStyle = `rgba(${rng.chance(0.5) ? '30,22,14' : '120,96,60'},${rng.range(0.25, 0.6)})`;
    ctx.lineWidth = rng.range(0.3, 0.7);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x + rng.range(-2, 2), l * 0.5, x + rng.range(-3, 3), l); ctx.stroke();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  grain(ctx, rng, cw, ch, 26);
  return canvas;
}

function drawRock(ctx, rock, rng) {
  const p = rock.pts;
  ctx.save();
  ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  const g = ctx.createLinearGradient(rock.x - rock.r, rock.y - rock.r, rock.x + rock.r, rock.y + rock.r);
  const base = 100 + rock.tone * 40;
  g.addColorStop(0, `rgb(${base + 38},${base + 32},${base + 22})`);
  g.addColorStop(1, `rgb(${base - 30},${base - 32},${base - 34})`);
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip();
  for (let i = 0; i < rock.r * 3; i++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
    ctx.beginPath(); ctx.arc(rock.x + rng.range(-rock.r, rock.r), rock.y + rng.range(-rock.r, rock.r), rng.range(0.4, 2.2), 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,250,240,0.18)'; ctx.lineWidth = rock.r * 0.25;
  ctx.beginPath(); ctx.ellipse(rock.x - rock.r * 0.25, rock.y - rock.r * 0.3, rock.r * 0.55, rock.r * 0.25, -0.3, Math.PI * 1.05, Math.PI * 1.75); ctx.stroke();
  if (rock.r > 14) {
    ctx.strokeStyle = 'rgba(30,25,20,0.35)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(rock.x - rock.r * 0.2, rock.y - rock.r * 0.4);
    ctx.lineTo(rock.x + rock.r * 0.05, rock.y); ctx.lineTo(rock.x - rock.r * 0.1, rock.y + rock.r * 0.35); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(25,18,12,0.55)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
}

// Ground plane in plane coordinates (x right, z away); canvas row 0 is the far edge.
export function makeGroundCanvas(surface, seed, scale = 2) {
  const rng = new Rng(seed ^ 0x9a7d);
  const cw = W * scale, ch = SURF_D * scale;
  const canvas = makeCanvas(cw, ch), ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const g = ctx.createLinearGradient(0, 0, 0, SURF_D);
  g.addColorStop(0, '#b29a78'); g.addColorStop(0.5, '#9d8160'); g.addColorStop(1, '#86684a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, SURF_D);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  mottle(ctx, rng, cw, ch, 1, 1, 700);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const Z = z => SURF_D - z;
  // Moss and low grass patches.
  for (let i = 0; i < 70; i++) {
    const x = rng.range(0, W), z = rng.range(0, SURF_D);
    if (Math.hypot(x - ENTRANCE.x, (z - ENTRANCE.z) * 1.4) < 80) continue;
    const r = rng.range(10, 40);
    const patch = ctx.createRadialGradient(x, Z(z), 0, x, Z(z), r);
    const green = rng.chance(0.6) ? '112,128,62' : '138,140,70';
    patch.addColorStop(0, `rgba(${green},0.45)`); patch.addColorStop(1, `rgba(${green},0)`);
    ctx.fillStyle = patch; ctx.beginPath(); ctx.ellipse(x, Z(z), r * 1.4, r, 0, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < r * 2; k++) {
      ctx.fillStyle = `rgba(${rng.chance(0.5) ? '86,110,48' : '128,146,70'},${rng.range(0.3, 0.7)})`;
      ctx.beginPath(); ctx.arc(x + rng.gauss() * r * 0.5, Z(z) + rng.gauss() * r * 0.35, rng.range(0.6, 1.6), 0, Math.PI * 2); ctx.fill();
    }
  }
  // Fine dirt speckles and small pebbles.
  for (let i = 0; i < 7000; i++) {
    const x = rng.range(0, W), y = rng.range(0, SURF_D), r = rng.chance(0.95) ? rng.range(0.3, 1) : rng.range(1.2, 3);
    ctx.fillStyle = rng.chance(0.5) ? `rgba(240,225,195,${rng.range(0.1, 0.35)})` : `rgba(40,26,14,${rng.range(0.1, 0.35)})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.6, 0, 0, Math.PI * 2); ctx.fill();
  }
  // Leaf litter: flat leaves and twigs.
  const leafColors = ['#8a6a3a', '#a27b42', '#6f5a33', '#9c8a4a', '#7a4f2c'];
  for (let i = 0; i < 26; i++) {
    const x = rng.range(10, W - 10), z = rng.range(20, SURF_D - 6);
    if (Math.hypot(x - ENTRANCE.x, (z - ENTRANCE.z) * 1.3) < 70) continue;
    if (rng.chance(0.3)) {
      ctx.strokeStyle = 'rgba(70,48,28,0.8)'; ctx.lineWidth = rng.range(1, 2.2); ctx.lineCap = 'round';
      const a = rng.range(0, Math.PI), l = rng.range(16, 44);
      ctx.beginPath(); ctx.moveTo(x, Z(z)); ctx.lineTo(x + Math.cos(a) * l, Z(z) + Math.sin(a) * l * 1.8); ctx.stroke();
      continue;
    }
    const size = rng.range(7, 16), rot = rng.range(0, Math.PI);
    ctx.save(); ctx.translate(x, Z(z)); ctx.scale(1, 1.7); ctx.rotate(rot);
    ctx.fillStyle = 'rgba(30,20,10,0.25)';
    ctx.beginPath(); ctx.ellipse(1, 1, size, size * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rng.pick(leafColors);
    ctx.beginPath(); ctx.moveTo(-size, 0); ctx.quadraticCurveTo(0, -size * 0.55, size, 0); ctx.quadraticCurveTo(0, size * 0.55, -size, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,20,0.45)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(-size, 0); ctx.lineTo(size, 0); ctx.stroke();
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * size * 0.3, 0); ctx.lineTo(k * size * 0.3 + size * 0.2, size * 0.25 * (k % 2 ? 1 : -1)); ctx.stroke(); }
    ctx.restore();
  }
  // Atmospheric haze toward the far edge.
  const haze = ctx.createLinearGradient(0, 0, 0, SURF_D * 0.5);
  haze.addColorStop(0, 'rgba(225,215,190,0.35)'); haze.addColorStop(1, 'rgba(225,215,190,0)');
  ctx.fillStyle = haze; ctx.fillRect(0, 0, W, SURF_D * 0.5);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  grain(ctx, rng, cw, ch, 18);
  return canvas;
}

export function makeCavityTile() {
  const rng = new Rng(77);
  const size = 128, c = makeCanvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = '#e6d2ae'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = rng.chance(0.5) ? `rgba(255,248,230,${rng.range(0.15, 0.5)})` : `rgba(150,110,70,${rng.range(0.08, 0.25)})`;
    ctx.beginPath(); ctx.arc(rng.range(0, size), rng.range(0, size), rng.range(0.3, 1.3), 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

// Standing grass tufts and plants for the ground plane (positions in plane coords).
export function makeFlora(surface, seed) {
  const rng = new Rng(seed ^ 0xf10a);
  const items = [];
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, W);
    const back = rng.chance(0.55);
    const z = back ? rng.range(SURF_D - 70, SURF_D - 2) : rng.range(25, SURF_D - 70);
    if (Math.hypot(x - ENTRANCE.x, (z - ENTRANCE.z) * 1.2) < 110) continue;
    if (surface.blocked(x, z, 6)) continue;
    const kind = rng.chance(0.08) ? 'flower' : rng.chance(0.12) ? 'clover' : 'grass';
    items.push({ x, z, kind, h: (back ? rng.range(14, 38) : rng.range(7, 18)) * (kind === 'flower' ? 1.4 : 1), n: 3 + rng.int(6), seed: rng.int(1e9), hue: rng.next() });
  }
  return items;
}

// Snow cover and autumn leaf litter for the ground plane (plane coordinates, far edge at row 0).
export function makeSnowCanvas(seed) {
  const rng = new Rng(seed ^ 0x5a0);
  const c = makeCanvas(W, SURF_D), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(244,247,250,0.92)'; ctx.fillRect(0, 0, W, SURF_D);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(150,140,125,${rng.range(0.15, 0.5)})`;
    ctx.beginPath(); ctx.ellipse(rng.range(0, W), rng.range(0, SURF_D), rng.range(2, 14), rng.range(1.5, 7), rng.range(0, 3), 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.9)' : 'rgba(200,210,225,0.5)';
    ctx.fillRect(rng.range(0, W), rng.range(0, SURF_D), rng.range(0.5, 1.5), rng.range(0.5, 1.5));
  }
  return c;
}

export function makeLeafCanvas(seed) {
  const rng = new Rng(seed ^ 0x1eaf);
  const c = makeCanvas(W * 2, SURF_D * 2), ctx = c.getContext('2d');
  ctx.scale(2, 2);
  const colors = ['#c0582a', '#d98a2b', '#a8402a', '#c9a23a', '#8a5a2a', '#e0b048'];
  for (let i = 0; i < 160; i++) {
    const x = rng.range(0, W), y = rng.range(0, SURF_D);
    if (Math.hypot(x - ENTRANCE.x, (SURF_D - y - ENTRANCE.z) * 1.3) < 50) continue;
    const size = rng.range(4, 11);
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 1.8); ctx.rotate(rng.range(0, Math.PI));
    ctx.fillStyle = 'rgba(30,20,10,0.22)';
    ctx.beginPath(); ctx.ellipse(0.8, 0.8, size, size * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rng.pick(colors);
    ctx.beginPath(); ctx.moveTo(-size, 0); ctx.quadraticCurveTo(0, -size * 0.6, size, 0); ctx.quadraticCurveTo(0, size * 0.6, -size, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(70,35,15,0.4)'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(-size, 0); ctx.lineTo(size, 0); ctx.stroke();
    ctx.restore();
  }
  return c;
}
