// Procedural sprites: ants, brood, food, stones and plants.
import { Rng } from '../sim/rng.js';
import { PELLET_COLORS } from './textures.js';

const TAU = Math.PI * 2;
const LEGS = [
  // attach x, knee (x, y), foot (x, y)
  [1.25, 2.0, 1.9, 3.1, 2.9],
  [0.7, 0.75, 2.25, 0.45, 3.65],
  [0.15, -0.45, 2.05, -2.0, 3.35],
];

function mix(a, b, t) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}
const BODY = [38, 22, 14], CALLOW = [176, 132, 86], DEAD = [92, 70, 54];

// Draw an ant in local coordinates (x = forward). `lod` 0 = full, 1 = simple, 2 = dot.
export function drawAnt(ctx, a, lod = 0, time = 0, extra = {}) {
  const queen = a.caste === 'queen' || a.caste === 'gyne';
  const male = a.caste === 'male';
  const s = (queen ? 1.5 : male ? 1.05 : 1) * (a.size || 1);
  const pale = a.callow > 0 ? Math.min(1, a.callow / 90) : 0;
  const color = extra.dead ? mix(DEAD, DEAD, 0) : mix(BODY, CALLOW, pale * 0.8);
  ctx.save();
  ctx.scale(s, s);
  if (lod >= 2) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(-0.5, 0, 4.2, 1.6, 0, 0, TAU); ctx.fill();
    ctx.restore(); return;
  }
  const g = a.gait || 0;
  const gasterR = queen ? [3.7, 2.5] : male ? [2.6, 1.3] : a.crop > 0.2 ? [2.5 + a.crop * 0.75, 1.85 + a.crop * 0.65] : [2.5, 1.85];
  const gx = queen ? -4.0 : male ? -3.2 : -3.05 - (a.crop || 0) * 0.4;
  if (lod === 0) {
    // Legs
    ctx.strokeStyle = color; ctx.lineWidth = 0.42; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const [ax, kx, ky, fx, fy] = LEGS[k];
      for (const side of [-1, 1]) {
        const phase = g + ((k + (side > 0 ? 1 : 0)) % 2) * Math.PI;
        const sw = extra.dead ? 0 : Math.sin(phase);
        const lift = extra.dead ? 0.5 : Math.cos(phase) > 0 ? 0.9 : 1;
        const curl = extra.dead ? 0.45 : 1;
        ctx.moveTo(ax, side * 0.5);
        ctx.lineTo(kx + sw * 0.45, side * ky * curl);
        ctx.lineTo(fx + sw * 0.95, side * fy * lift * curl);
      }
    }
    ctx.stroke();
    // Antennae
    const sway = extra.dead ? 0 : Math.sin(time * 5 + (a.id || 0)) * 0.35;
    const dig = extra.digging ? Math.sin(time * 18) * 0.4 : 0;
    ctx.lineWidth = 0.32;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(3.55, side * 0.45);
      ctx.lineTo(4.35 + dig, side * 1.55);
      ctx.lineTo(5.85 + dig, side * (1.25 + sway * side));
    }
    ctx.stroke();
  }
  // Body: gaster, petiole, mesosoma and head in one path
  const pet = queen ? -1.2 : -0.95, mrx = queen ? 1.9 : 1.55, mry = queen ? 1.1 : 0.82;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(gx + gasterR[0], 0); ctx.ellipse(gx, 0, gasterR[0], gasterR[1], 0, 0, TAU);
  ctx.moveTo(pet + 0.6, 0); ctx.arc(pet, 0, 0.6, 0, TAU);
  ctx.moveTo(0.65 + mrx, 0); ctx.ellipse(0.65, 0, mrx, mry, 0, 0, TAU);
  if (male) { ctx.moveTo(2.8 + 0.9, 0); ctx.ellipse(2.8, 0, 0.9, 0.85, 0, 0, TAU); }
  else { ctx.moveTo(2.95 + 1.25, 0); ctx.ellipse(2.95, 0, 1.25, 1.15, 0, 0, TAU); }
  ctx.fill();
  if (male && lod === 0) {
    ctx.fillStyle = 'rgba(120,110,100,0.9)';
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(3.05, side * 0.75, 0.42, 0, TAU); ctx.fill(); }
  }
  if (a.crop > 0.2 && !queen) {
    ctx.fillStyle = `rgba(232,170,60,${0.35 * a.crop})`;
    ctx.beginPath(); ctx.ellipse(gx - 0.2, 0, gasterR[0] * 0.75, gasterR[1] * 0.6, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 0.35;
    for (const off of [-0.9, 0.3]) { ctx.beginPath(); ctx.ellipse(gx + off, 0, 0.4, gasterR[1] * 0.92, 0, 0, TAU); ctx.stroke(); }
  }
  if (lod === 0) {
    // Highlights
    ctx.fillStyle = 'rgba(255,225,190,0.22)';
    ctx.beginPath(); ctx.ellipse(gx + 0.5, -gasterR[1] * 0.4, gasterR[0] * 0.55, gasterR[1] * 0.3, -0.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3.1, -0.45, 0.6, 0.35, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0.8, -0.35, 0.8, 0.25, 0, 0, TAU); ctx.fill();
    // Mandibles
    ctx.strokeStyle = color; ctx.lineWidth = 0.38;
    const open = extra.digging || extra.harvest ? 0.25 + Math.abs(Math.sin(time * 10)) * 0.25 : 0;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(3.9, side * 0.55); ctx.quadraticCurveTo(4.6, side * (0.6 + open), 4.55, side * (0.12 + open * 0.5)); ctx.stroke();
    }
    if (queen && !a.wings && a.caste === 'queen') {
      ctx.fillStyle = 'rgba(200,170,130,0.5)';
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(0.3, side * 0.8, 0.3, 0, TAU); ctx.fill(); }
    }
  }
  // Wings (new queens and males). In flight they beat; on the ground they rest folded.
  if (a.wings && !extra.dead) {
    const beat = extra.flap ? Math.abs(Math.sin(extra.flap * 38)) : 0;
    const len = male ? 4.6 : 5.2;
    ctx.fillStyle = 'rgba(232,238,245,0.5)'; ctx.strokeStyle = 'rgba(110,115,130,0.55)'; ctx.lineWidth = 0.15;
    for (const side of [-1, 1]) {
      const rot = side * (0.16 + beat * 1.1);
      ctx.save(); ctx.translate(0.4, side * 0.5); ctx.rotate(Math.PI + rot);
      ctx.beginPath(); ctx.ellipse(len * 0.95, 0, len, 1.25, 0, 0, TAU); ctx.fill(); if (!lod) ctx.stroke();
      ctx.restore();
    }
  }
  // Cargo held in the mandibles
  if (a.cargo && !extra.dead) drawCargo(ctx, a.cargo, lod);
  ctx.restore();
}

function drawCargo(ctx, cargo, lod) {
  const x = 5.2;
  switch (cargo.k) {
    case 'soil':
      ctx.fillStyle = PELLET_COLORS[cargo.s] || '#7a5a3c';
      ctx.beginPath(); ctx.arc(x, 0, 1.55, 0, TAU); ctx.fill();
      if (!lod) { ctx.fillStyle = 'rgba(255,240,220,0.25)'; ctx.beginPath(); ctx.arc(x - 0.4, -0.4, 0.6, 0, TAU); ctx.fill(); }
      break;
    case 'seed':
      ctx.fillStyle = '#c9a66b';
      ctx.beginPath(); ctx.ellipse(x + 0.3, 0, 1.9, 1.15, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(110,80,40,0.6)'; ctx.lineWidth = 0.25;
      ctx.beginPath(); ctx.moveTo(x - 1.2, 0); ctx.lineTo(x + 1.8, 0); ctx.stroke();
      break;
    case 'meat':
      ctx.fillStyle = '#8a4a2a';
      ctx.beginPath(); ctx.moveTo(x - 1, -1.2); ctx.lineTo(x + 1.6, -0.8); ctx.lineTo(x + 1.3, 1.1); ctx.lineTo(x - 0.8, 1.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(200,140,90,0.6)'; ctx.beginPath(); ctx.arc(x + 0.2, -0.2, 0.5, 0, TAU); ctx.fill();
      break;
    case 'brood':
      if (cargo.stage === 'egg') drawEgg(ctx, x - 0.2, 0, 0, 0.8);
      else if (cargo.stage === 'larva') drawLarva(ctx, x + 0.4, 0, 0.6, 0, false, 0.8);
      else drawPupa(ctx, x + 1, 0, 0.5, 0.8, Math.PI / 2);
      break;
    case 'corpse':
      ctx.save(); ctx.translate(x + 3, 0); ctx.rotate(Math.PI); ctx.scale(0.85, 0.85);
      drawAnt(ctx, { caste: 'worker', size: 1, gait: 0 }, 1, 0, { dead: true });
      ctx.restore();
      break;
  }
}

export function drawEgg(ctx, x, y, seed = 0, s = 1) {
  ctx.fillStyle = '#fbf6e8';
  ctx.strokeStyle = 'rgba(140,115,80,0.55)'; ctx.lineWidth = 0.25;
  ctx.beginPath(); ctx.ellipse(x, y, 1.55 * s, 1.1 * s, seed, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath(); ctx.ellipse(x - 0.45 * s, y - 0.35 * s, 0.5 * s, 0.3 * s, 0, 0, TAU); ctx.fill();
}

export function drawLarva(ctx, x, y, p, rot = 0, hungry = false, s = 1) {
  const k = (0.65 + p * 0.55) * s;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(k, k);
  ctx.fillStyle = hungry ? '#efe6d2' : '#fbf3e0';
  ctx.strokeStyle = 'rgba(150,120,80,0.6)'; ctx.lineWidth = 0.28;
  ctx.beginPath();
  ctx.ellipse(0, 0, 2.7, 1.95, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(170,140,100,0.45)'; ctx.lineWidth = 0.22;
  for (let i = -1; i <= 1.5; i += 0.8) { ctx.beginPath(); ctx.moveTo(i, -1.75); ctx.quadraticCurveTo(i + 0.4, 0, i, 1.75); ctx.stroke(); }
  ctx.fillStyle = '#d9c19a';
  ctx.beginPath(); ctx.arc(2.25, -0.95, 0.65, 0, TAU); ctx.fill();
  if (!hungry && p > 0.1) {
    ctx.fillStyle = 'rgba(200,150,90,0.35)';
    ctx.beginPath(); ctx.ellipse(-0.3, 0.2, 1.1, 0.7, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

export function drawPupa(ctx, x, y, p, s = 1, rot = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.fillStyle = '#efdcb4';
  ctx.strokeStyle = 'rgba(140,105,60,0.6)'; ctx.lineWidth = 0.3;
  ctx.beginPath(); ctx.ellipse(0, 0, 1.55, 3.3, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(150,115,70,0.35)'; ctx.lineWidth = 0.25;
  for (const yy of [-0.8, 0.4, 1.5]) { ctx.beginPath(); ctx.moveTo(-1.4, yy); ctx.quadraticCurveTo(0, yy + 0.4, 1.4, yy); ctx.stroke(); }
  if (p > 0.55) {
    ctx.fillStyle = `rgba(40,25,15,${(p - 0.55) * 1.4})`;
    ctx.beginPath(); ctx.arc(-0.55, -2.4, 0.38, 0, TAU); ctx.arc(0.55, -2.4, 0.38, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// Food on the ground plane. Drawn around (0, 0) in screen-aligned space; `sq` squashes depth.
export function drawFood(ctx, f, spec, time, sq) {
  const frac = Math.max(0, f.amount / f.max);
  const r = spec.radius * (0.55 + 0.45 * Math.sqrt(frac));
  switch (f.type) {
    case 'honey': case 'nectar': {
      if (f.type === 'nectar') {
        ctx.fillStyle = '#e9b8c9';
        for (let k = 0; k < 5; k++) {
          const a = k / 5 * TAU + f.rot;
          ctx.beginPath(); ctx.ellipse(Math.cos(a) * 3.2, Math.sin(a) * 3.2 * sq, 3, 1.8 * sq + 0.3, a, 0, TAU); ctx.fill();
        }
      }
      ctx.fillStyle = 'rgba(60,35,10,0.22)';
      ctx.beginPath(); ctx.ellipse(1, 1, r * 1.05, r * sq * 1.05, 0, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(-r * 0.3, -r * sq * 0.5, r * 0.1, 0, 0, r);
      g.addColorStop(0, 'rgba(255,214,120,0.95)'); g.addColorStop(0.6, 'rgba(226,150,40,0.92)'); g.addColorStop(1, 'rgba(170,95,20,0.9)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, -r * 0.12, r, r * sq + r * 0.18, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,240,0.75)';
      ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.35, r * 0.28, r * 0.12, -0.3, 0, TAU); ctx.fill();
      break;
    }
    case 'apple': {
      ctx.save(); ctx.scale(1, sq + 0.12);
      ctx.rotate(f.rot * 0.3);
      ctx.fillStyle = 'rgba(40,20,10,0.25)';
      ctx.beginPath(); ctx.ellipse(1.5, 2, r * 1.15, r * 0.6, 0, 0, TAU); ctx.fill();
      const w = r * 1.15 * (0.6 + 0.4 * frac), h = r * 0.65;
      ctx.fillStyle = '#b8322a';
      ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f3e3b5';
      ctx.beginPath(); ctx.ellipse(0, -h * 0.12, w * 0.9, h * 0.78, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(220,190,120,0.6)';
      ctx.beginPath(); ctx.ellipse(0, -h * 0.1, w * 0.45, h * 0.3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a3418';
      ctx.beginPath(); ctx.ellipse(-w * 0.15, -h * 0.1, 0.9, 0.55, 0.4, 0, TAU); ctx.ellipse(w * 0.18, -h * 0.05, 0.9, 0.55, -0.4, 0, TAU); ctx.fill();
      // bite marks
      const bites = Math.floor((1 - frac) * 8);
      ctx.fillStyle = 'rgba(200,160,90,0.8)';
      const rng = new Rng(f.seed);
      for (let k = 0; k < bites; k++) { ctx.beginPath(); ctx.arc(rng.range(-w, w) * 0.8, rng.range(-h, h) * 0.6, rng.range(0.8, 1.8), 0, TAU); ctx.fill(); }
      ctx.restore();
      break;
    }
    case 'cricket': case 'bug': {
      const big = f.type === 'cricket';
      ctx.save(); ctx.scale(1, sq + 0.15); ctx.rotate(f.rot);
      const k = big ? 1 : 0.42;
      ctx.scale(k, k);
      ctx.fillStyle = 'rgba(30,15,5,0.25)';
      ctx.beginPath(); ctx.ellipse(1.5, 1.5, 15, 6, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.35 + 0.65 * frac;
      const body = big ? '#5b3a1e' : '#2f3a22';
      ctx.strokeStyle = body; ctx.lineCap = 'round';
      if (big) {
        ctx.lineWidth = 1.6;
        for (const side of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(-2, side * 2); ctx.lineTo(-7, side * 7); ctx.lineTo(-15, side * 5.5); ctx.stroke();
        }
        ctx.lineWidth = 0.6;
        for (const [ax, fx] of [[4, 8], [1, 2]]) for (const side of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(ax, side * 2); ctx.lineTo(fx, side * 6); ctx.stroke();
        }
        ctx.lineWidth = 0.35;
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(9, side); ctx.quadraticCurveTo(16, side * 6, 22, side * 4); ctx.stroke(); }
      } else {
        ctx.lineWidth = 0.9;
        for (const x of [-3, 0, 3]) for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x, side * 2); ctx.lineTo(x + 1, side * 6); ctx.stroke(); }
      }
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.ellipse(-4, 0, big ? 8 : 7, big ? 3.4 : 5, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(4, 0, big ? 3.4 : 3, big ? 3 : 4, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(8.2, 0, big ? 2.4 : 2, big ? 2.5 : 2.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = big ? 'rgba(160,110,60,0.45)' : 'rgba(120,170,110,0.4)';
      ctx.beginPath(); ctx.ellipse(-4, -1, big ? 6 : 5, 1.2, 0, 0, TAU); ctx.fill();
      if (big) {
        ctx.strokeStyle = 'rgba(30,15,5,0.5)'; ctx.lineWidth = 0.4;
        for (let x = -10; x < 2; x += 2.4) { ctx.beginPath(); ctx.moveTo(x, -3); ctx.lineTo(x, 3); ctx.stroke(); }
      }
      ctx.restore();
      break;
    }
    case 'seeds': case 'grass': {
      const rng = new Rng(f.seed);
      const n = Math.ceil(f.amount), spread = f.type === 'seeds' ? spec.radius : 4;
      const list = [];
      for (let k = 0; k < Math.ceil(f.max); k++) {
        const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * spread;
        list.push({ x: Math.cos(a) * d, y: Math.sin(a) * d * sq, rot: rng.range(0, TAU), tone: rng.next() });
      }
      list.sort((p, q) => p.y - q.y);
      for (let k = 0; k < list.length; k++) {
        if (k >= n) break;
        const p = list[k];
        drawSeed(ctx, p.x, p.y, p.rot, p.tone, f.type === 'grass' ? 0.7 : 1);
      }
      break;
    }
  }
}

export function drawSeed(ctx, x, y, rot, tone, s = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(40,25,10,0.25)';
  ctx.beginPath(); ctx.ellipse(0.4, 0.6, 2.1, 1.3, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = tone > 0.5 ? '#d1ae72' : '#b98f55';
  ctx.beginPath(); ctx.ellipse(0, 0, 2.1, 1.25, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(100,70,35,0.6)'; ctx.lineWidth = 0.25;
  ctx.beginPath(); ctx.moveTo(-1.6, 0); ctx.lineTo(1.7, 0); ctx.stroke();
  ctx.fillStyle = 'rgba(255,245,215,0.45)';
  ctx.beginPath(); ctx.ellipse(-0.5, -0.45, 0.8, 0.3, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

export function drawStone(ctx, o, sq) {
  const rx = o.r, ry = o.r * (sq + 0.35);
  ctx.fillStyle = 'rgba(30,20,10,0.3)';
  ctx.beginPath(); ctx.ellipse(o.r * 0.25, ry * 0.25, rx * 1.05, ry * 0.75, 0, 0, TAU); ctx.fill();
  const base = 120 + o.tone * 50;
  const g = ctx.createRadialGradient(-rx * 0.35, -ry * 0.9, rx * 0.1, 0, -ry * 0.3, rx * 1.2);
  g.addColorStop(0, `rgb(${base + 70},${base + 64},${base + 52})`);
  g.addColorStop(0.55, `rgb(${base},${base - 6},${base - 16})`);
  g.addColorStop(1, `rgb(${base - 55},${base - 58},${base - 62})`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, -ry * 0.35, rx, ry, 0, 0, TAU); ctx.fill();
}

// Seasonal leaf colour: fresh green -> straw as `dry` goes 0 -> 1.
export function leafRGB(r, g, b, dry, shade) {
  return `rgb(${Math.round((r + (168 - r) * dry) * shade)},${Math.round((g + (138 - g) * dry) * shade)},${Math.round((b + (82 - b) * dry) * shade)})`;
}

export function drawPlant(ctx, p, time, light, season = { dry: 0, bloom: true }) {
  const rng = new Rng(p.seed);
  const wind = Math.sin(time * 0.9 + p.x * 0.02) * 0.6 + Math.sin(time * 2.3 + p.x * 0.07) * 0.25;
  const shade = 0.55 + light * 0.45, dry = season.dry;
  if (p.kind === 'clover') {
    for (let k = 0; k < 3; k++) {
      const sx = rng.range(-6, 6), h = p.h * rng.range(0.5, 0.9);
      const tx = sx + wind * h * 0.06, ty = -h;
      ctx.strokeStyle = leafRGB(80, 120, 50, dry, shade); ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(sx * 0.3, 0); ctx.quadraticCurveTo(sx, -h * 0.5, tx, ty); ctx.stroke();
      ctx.fillStyle = leafRGB(92, 140, 62, dry, shade);
      for (let l = 0; l < 3; l++) {
        const a = l / 3 * TAU - Math.PI / 2;
        ctx.beginPath(); ctx.ellipse(tx + Math.cos(a) * 2.6, ty + Math.sin(a) * 1.6, 2.7, 1.9, a, 0, TAU); ctx.fill();
      }
    }
    return;
  }
  for (let k = 0; k < p.n; k++) {
    const sx = rng.range(-5, 5), h = p.h * rng.range(0.55, 1), lean = rng.range(-0.5, 0.5);
    const tipx = sx + (lean + wind * 0.25) * h * 0.5;
    const g = 0.75 + rng.next() * 0.35;
    ctx.fillStyle = leafRGB(96 * g, 128 * g, 58 * g, dry, shade);
    ctx.beginPath();
    ctx.moveTo(sx - 1.1, 0);
    ctx.quadraticCurveTo(sx + lean * h * 0.2, -h * 0.55, tipx, -h);
    ctx.quadraticCurveTo(sx + lean * h * 0.2 + 0.6, -h * 0.5, sx + 1.1, 0);
    ctx.fill();
  }
  if (p.kind === 'flower' && season.bloom) {
    const tx = wind * p.h * 0.12, ty = -p.h * 1.05;
    ctx.strokeStyle = leafRGB(80, 115, 50, dry, shade); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(0, -p.h * 0.6, tx, ty); ctx.stroke();
    const hue = p.hue < 0.5 ? [250, 236, 160] : [245, 245, 240];
    ctx.fillStyle = `rgb(${Math.round(hue[0] * shade)},${Math.round(hue[1] * shade)},${Math.round(hue[2] * shade)})`;
    for (let l = 0; l < 8; l++) {
      const a = l / 8 * TAU;
      ctx.beginPath(); ctx.ellipse(tx + Math.cos(a) * 2.6, ty + Math.sin(a) * 1.5, 2.2, 0.9, a, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = `rgb(${Math.round(230 * shade)},${Math.round(170 * shade)},${Math.round(40 * shade)})`;
    ctx.beginPath(); ctx.arc(tx, ty, 1.5, 0, TAU); ctx.fill();
  }
}
