// The ground plane: food, trail pheromone, the spoil mound and obstacles.
import { W, SURF_D, ENTRANCE, MIDDEN, FOODS } from './config.js';
import { Rng, clamp } from './rng.js';

export const PG = 8;                       // pheromone grid cell
export const PCOLS = W / PG, PROWS = Math.ceil(SURF_D / PG);
export const MG = 4;                       // mound height grid cell
export const MCOLS = W / MG, MROWS = Math.ceil(SURF_D / MG);
const TRAIL_LIFE = 55;                     // seconds for a trail to fade to ~37%

export class Surface {
  constructor(seed) {
    const rng = new Rng(seed ^ 0xa11ce);
    this.pher = new Float32Array(PCOLS * PROWS);
    this.mound = new Float32Array(MCOLS * MROWS);
    this.foods = [];
    this.nextFood = 1;
    this.obstacles = [];
    for (let k = 0; k < 60 && this.obstacles.length < 7; k++) {
      const r = rng.range(7, 17), x = rng.range(40, W - 40), z = rng.range(40, SURF_D - 30);
      if (Math.hypot(x - ENTRANCE.x, z - ENTRANCE.z) < 110) continue;
      if (Math.hypot(x - MIDDEN.x, z - MIDDEN.z) < 50) continue;
      if (this.obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + r + 70)) continue;
      this.obstacles.push({ x, z, r, tone: rng.next() });
    }
    this.wings = null;
    this.midden = 0;
    this.evapTimer = 0;
  }

  // ---------------------------------------------------------------- pheromone
  deposit(x, z, amount) {
    const gx = x / PG - 0.5, gz = z / PG - 0.5;
    const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r;
    const add = (cc, rr, w) => {
      if (cc < 0 || cc >= PCOLS || rr < 0 || rr >= PROWS) return;
      const i = rr * PCOLS + cc;
      this.pher[i] = Math.min(6, this.pher[i] + amount * w);
    };
    add(c, r, (1 - fx) * (1 - fz)); add(c + 1, r, fx * (1 - fz));
    add(c, r + 1, (1 - fx) * fz); add(c + 1, r + 1, fx * fz);
  }

  sample(x, z) {
    const gx = x / PG - 0.5, gz = z / PG - 0.5;
    const c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r;
    const g = (cc, rr) => (cc < 0 || cc >= PCOLS || rr < 0 || rr >= PROWS) ? 0 : this.pher[rr * PCOLS + cc];
    return g(c, r) * (1 - fx) * (1 - fz) + g(c + 1, r) * fx * (1 - fz) + g(c, r + 1) * (1 - fx) * fz + g(c + 1, r + 1) * fx * fz;
  }

  evaporate(dt) {
    this.evapTimer += dt;
    if (this.evapTimer < 0.5) return;
    const k = Math.exp(-this.evapTimer / TRAIL_LIFE);
    this.evapTimer = 0;
    const p = this.pher;
    for (let i = 0; i < p.length; i++) { const v = p[i] * k; p[i] = v < 0.004 ? 0 : v; }
  }

  // ---------------------------------------------------------------- mound
  height(x, z) {
    const c = Math.floor(x / MG), r = Math.floor(z / MG);
    if (c < 0 || c >= MCOLS || r < 0 || r >= MROWS) return 0;
    return this.mound[r * MCOLS + c];
  }

  // Drop a soil pellet. Material slumps outward once the slope gets too steep.
  depositSoil(x, z, amount = 0.55) {
    const c0 = Math.floor(x / MG), r0 = Math.floor(z / MG);
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const c = c0 + dc, r = r0 + dr;
      if (c < 0 || c >= MCOLS || r < 0 || r >= MROWS) continue;
      const w = Math.exp(-(dc * dc + dr * dr) / 2.2);
      this.mound[r * MCOLS + c] += amount * w;
    }
    for (let it = 0; it < 3; it++) {
      for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (c < 1 || c >= MCOLS - 1 || r < 1 || r >= MROWS - 1) continue;
        const i = r * MCOLS + c;
        for (const j of [i - 1, i + 1, i - MCOLS, i + MCOLS]) {
          const diff = this.mound[i] - this.mound[j];
          if (diff > 2.2) { const m = (diff - 2.2) * 0.25; this.mound[i] -= m; this.mound[j] += m; }
        }
      }
    }
  }

  // ---------------------------------------------------------------- food
  addFood(type, x, z, rng, user = true) {
    const spec = FOODS[type];
    if (!spec) return null;
    const f = {
      id: this.nextFood++, type, x: clamp(x, 16, W - 16), z: clamp(z, 8, SURF_D - 8),
      amount: spec.amount, max: spec.amount, rot: rng.range(-Math.PI, Math.PI), seed: rng.int(1e9), user,
      found: false, visitors: 0,
    };
    this.foods.push(f);
    return f;
  }

  blocked(x, z, pad = 0) {
    for (const o of this.obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + pad) return o;
    return null;
  }

  canPlace(x, z) {
    if (x < 14 || x > W - 14 || z < 6 || z > SURF_D - 6) return false;
    if (Math.hypot(x - ENTRANCE.x, z - ENTRANCE.z) < 16) return false;
    return !this.blocked(x, z, 4);
  }

  serialize() {
    const q = new Uint8Array(this.mound.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.min(255, Math.round(this.mound[i] * 4));
    const p = new Uint8Array(this.pher.length);
    for (let i = 0; i < p.length; i++) p[i] = Math.min(255, Math.round(this.pher[i] * 40));
    return { mound: toB64(q), pher: toB64(p), foods: this.foods, nextFood: this.nextFood, wings: this.wings, midden: this.midden };
  }

  restore(d) {
    const q = fromB64(d.mound);
    for (let i = 0; i < Math.min(q.length, this.mound.length); i++) this.mound[i] = q[i] / 4;
    if (d.pher) { const p = fromB64(d.pher); for (let i = 0; i < Math.min(p.length, this.pher.length); i++) this.pher[i] = p[i] / 40; }
    this.foods = d.foods || []; this.nextFood = d.nextFood || 1; this.wings = d.wings || null; this.midden = d.midden || 0;
  }
}

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(text) {
  const s = atob(text), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
