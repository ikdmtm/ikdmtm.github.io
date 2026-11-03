// Procedural soil: layered strata, embedded rocks (undiggable) and decorative roots.
// Generation depends only on the seed so a saved colony can rebuild it.
import { COLS, ROWS, CELL, W, SOIL_H, ENTRANCE, ROCK } from './config.js';
import { Rng } from './rng.js';

const BASE_DEPTHS = [64, 210, 400, 580];

function wave(rng, base, amp) {
  const parts = Array.from({ length: 4 }, (_, i) => ({
    f: (0.6 + i * 1.7 + rng.next()) * Math.PI * 2 / W, p: rng.next() * 7, a: amp / (i + 1),
  }));
  return Array.from({ length: COLS + 1 }, (_, c) => {
    const x = c * CELL;
    return base + parts.reduce((s, q) => s + Math.sin(x * q.f + q.p) * q.a, 0);
  });
}

function rockShape(rng, x, y, r) {
  const n = 11 + rng.int(5), squash = rng.range(0.55, 0.85), rot = rng.range(-0.5, 0.5);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, rr = r * rng.range(0.78, 1.08);
    const lx = Math.cos(a) * rr, ly = Math.sin(a) * rr * squash;
    pts.push({ x: x + lx * Math.cos(rot) - ly * Math.sin(rot), y: y + lx * Math.sin(rot) + ly * Math.cos(rot) });
  }
  return { x, y, r, pts, tone: rng.next() };
}

function inside(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

export function generateSoil(seed) {
  const rng = new Rng(seed ^ 0x5eed);
  const strata = BASE_DEPTHS.map((d, i) => wave(rng, d, 10 + i * 5));
  const grid = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const y = r * CELL + CELL / 2;
      let t = 1;
      for (let k = 0; k < strata.length; k++) if (y > strata[k][c]) t = k + 2;
      grid[r * COLS + c] = t;
    }
  }
  const rocks = [];
  const tries = 160;
  for (let i = 0; i < tries && rocks.length < 22; i++) {
    const big = rng.chance(0.3);
    const r = big ? rng.range(22, 44) : rng.range(8, 18);
    const x = rng.range(30, W - 30), y = rng.range(40 + r, SOIL_H - 10);
    if (Math.abs(x - ENTRANCE.x) < 120 + r && y < 200 + r) continue; // keep the founding area diggable
    if (rocks.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + 26)) continue;
    rocks.push(rockShape(rng, x, y, r));
  }
  for (const rock of rocks) {
    const c0 = Math.max(0, Math.floor((rock.x - rock.r * 1.2) / CELL)), c1 = Math.min(COLS - 1, Math.ceil((rock.x + rock.r * 1.2) / CELL));
    const r0 = Math.max(0, Math.floor((rock.y - rock.r * 1.2) / CELL)), r1 = Math.min(ROWS - 1, Math.ceil((rock.y + rock.r * 1.2) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (inside(rock.pts, c * CELL + CELL / 2, r * CELL + CELL / 2)) grid[r * COLS + c] = ROCK;
    }
  }
  const roots = [];
  for (let i = 0; i < 18; i++) {
    const x = rng.range(20, W - 20);
    if (Math.abs(x - ENTRANCE.x) < 50) continue;
    const pts = [{ x, y: 0 }];
    let a = Math.PI / 2 + rng.range(-0.4, 0.4), px = x, py = 0;
    const len = rng.range(40, 170);
    for (let s = 0; s < len; s += 8) {
      a += rng.range(-0.35, 0.35); a = Math.max(0.5, Math.min(Math.PI - 0.5, a));
      px += Math.cos(a) * 8; py += Math.sin(a) * 8; pts.push({ x: px, y: py });
    }
    roots.push({ pts, w: rng.range(0.8, 2.2) });
  }
  return { grid, strata, rocks, roots };
}
