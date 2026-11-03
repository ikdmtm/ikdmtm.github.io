// Smooth outline of the dug nest: blur the open-cell grid, run marching squares
// at the 0.5 level, stitch segments into loops and round them with Chaikin.
import { COLS, ROWS, CELL } from '../sim/config.js';

export function buildNestOutline(nest) {
  const b = nest.bounds;
  if (nest.openCount === 0) return { path: new Path2D(), loops: [] };
  const c0 = Math.max(0, b.c0 - 3), c1 = Math.min(COLS - 1, b.c1 + 3);
  const r0 = -3, r1 = Math.min(ROWS - 1, b.r1 + 3);
  const nc = c1 - c0 + 1, nr = r1 - r0 + 1;
  const grid = nest.grid;
  const raw = (c, r) => {
    if (c < 0 || c >= COLS || r >= ROWS || r < -2) return 0;
    if (r < 0) r = 0; // the shaft continues up through the surface
    return grid[r * COLS + c] === 0 ? 1 : 0;
  };
  // 3x3 blurred cell values
  const blur = new Float32Array(nc * nr);
  for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
    const gc = c + c0, gr = r + r0;
    let s = 4 * raw(gc, gr);
    s += 2 * (raw(gc - 1, gr) + raw(gc + 1, gr) + raw(gc, gr - 1) + raw(gc, gr + 1));
    s += raw(gc - 1, gr - 1) + raw(gc + 1, gr - 1) + raw(gc - 1, gr + 1) + raw(gc + 1, gr + 1);
    blur[r * nc + c] = s / 16;
  }
  const B = (c, r) => (c < 0 || c >= nc || r < 0 || r >= nr) ? 0 : blur[r * nc + c];
  // Corner values: corner (i, j) sits between cells (i-1..i, j-1..j)
  const ncx = nc + 1, ncy = nr + 1;
  const corner = new Float32Array(ncx * ncy);
  for (let j = 0; j < ncy; j++) for (let i = 0; i < ncx; i++) {
    corner[j * ncx + i] = (B(i - 1, j - 1) + B(i, j - 1) + B(i - 1, j) + B(i, j)) / 4;
  }
  const X = i => (i + c0) * CELL, Y = j => (j + r0) * CELL;
  const T = 0.5;
  const pts = new Map();          // edge key -> point
  const adj = new Map();          // edge key -> [edge keys]
  const edgePoint = (key, ax, ay, av, bx, by, bv) => {
    if (!pts.has(key)) {
      const t = (T - av) / (bv - av);
      pts.set(key, [ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
    return key;
  };
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b); adj.get(b).push(a);
  };
  for (let j = 0; j < ncy - 1; j++) for (let i = 0; i < ncx - 1; i++) {
    const tl = corner[j * ncx + i], tr = corner[j * ncx + i + 1];
    const bl = corner[(j + 1) * ncx + i], br = corner[(j + 1) * ncx + i + 1];
    const idx = (tl > T ? 8 : 0) | (tr > T ? 4 : 0) | (br > T ? 2 : 0) | (bl > T ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const x0 = X(i), x1 = X(i + 1), y0 = Y(j), y1 = Y(j + 1);
    const top = () => edgePoint(((j * ncx + i) << 1), x0, y0, tl, x1, y0, tr);
    const bottom = () => edgePoint((((j + 1) * ncx + i) << 1), x0, y1, bl, x1, y1, br);
    const left = () => edgePoint(((j * ncx + i) << 1) | 1, x0, y0, tl, x0, y1, bl);
    const right = () => edgePoint(((j * ncx + i + 1) << 1) | 1, x1, y0, tr, x1, y1, br);
    switch (idx) {
      case 1: case 14: link(left(), bottom()); break;
      case 2: case 13: link(bottom(), right()); break;
      case 3: case 12: link(left(), right()); break;
      case 4: case 11: link(top(), right()); break;
      case 6: case 9: link(top(), bottom()); break;
      case 7: case 8: link(left(), top()); break;
      case 5: case 10: {
        const center = (tl + tr + bl + br) / 4;
        if ((center > T) === (idx === 5)) { link(left(), top()); link(bottom(), right()); }
        else { link(left(), bottom()); link(top(), right()); }
        break;
      }
    }
  }
  // Stitch into loops
  const used = new Set(), loops = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let prev = null, cur = start;
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur); loop.push(pts.get(cur));
      const next = adj.get(cur).find(k => k !== prev && !used.has(k));
      prev = cur; cur = next;
    }
    if (loop.length > 2) loops.push(chaikin(chaikin(loop)));
  }
  const path = new Path2D();
  for (const loop of loops) {
    path.moveTo(loop[0][0], loop[0][1]);
    for (let k = 1; k < loop.length; k++) path.lineTo(loop[k][0], loop[k][1]);
    path.closePath();
  }
  return { path, loops };
}

function chaikin(p) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}
