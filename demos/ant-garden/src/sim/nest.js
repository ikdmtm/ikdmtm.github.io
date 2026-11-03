// The nest: which soil cells are open, how the colony extends the nest, and
// navigation fields through the tunnels.
//
// Growth is need-driven. When the colony needs more room, it extends a shaft
// downward or opens a flat chamber off an existing shaft (the typical
// "shaft and pancake chamber" architecture of ground nests). Planned shapes are
// excavated one pellet at a time by individual ants, starting from the cells
// that touch open space, so the nest visibly grows from where ants work.
import { COLS, ROWS, CELL, W, SOIL_H, ENTRANCE_COL, ROCK } from './config.js';
import { clamp, lerp } from './rng.js';

const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

export const cellOf = (x, y) => {
  const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
  return r * COLS + c;
};
export const cx = i => (i % COLS) * CELL + CELL / 2;
export const cy = i => Math.floor(i / COLS) * CELL + CELL / 2;

class Heap {
  constructor() { this.ids = []; this.keys = []; }
  push(id, key) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length; ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p]; i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop() {
    const ids = this.ids, keys = this.keys, top = ids[0];
    const lastId = ids.pop(), lastKey = keys.pop();
    if (ids.length) {
      let i = 0; const n = ids.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c]; keys[i] = keys[c]; i = c;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
  get size() { return this.ids.length; }
}

export class Nest {
  constructor(soil) {
    this.grid = soil.grid;            // 0 = open, 1-5 soil type, 9 rock
    this.soilType = new Uint8Array(soil.grid); // original material, for pellet colours
    this.own = new Int16Array(COLS * ROWS).fill(-1);
    this.claims = new Map();
    this.features = [];
    this.shafts = [];
    this.nextFeature = 1;
    this.version = 1;
    this.openCount = 0;
    this.recent = [];                  // freshly dug cells, for the damp-soil effect
    this.fields = new Map();
    this.bounds = { c0: ENTRANCE_COL, c1: ENTRANCE_COL, r0: 0, r1: 0 };
    this.roleCycle = 0;
  }

  isOpen(i) { return i >= 0 && this.grid[i] === 0; }
  openAt(x, y) { return this.isOpen(cellOf(x, y)); }

  open(i, time = 0) {
    if (i < 0 || this.grid[i] === 0 || this.grid[i] === ROCK) return false;
    this.grid[i] = 0;
    this.openCount++;
    this.version++;
    const c = i % COLS, r = Math.floor(i / COLS), b = this.bounds;
    if (c < b.c0) b.c0 = c; if (c > b.c1) b.c1 = c; if (r < b.r0) b.r0 = r; if (r > b.r1) b.r1 = r;
    this.recent.push({ i, t: time });
    if (this.recent.length > 600) this.recent.splice(0, this.recent.length - 600);
    return true;
  }

  get area() { return this.openCount * CELL * CELL; }
  get depth() { return (this.bounds.r1 + 1) * CELL; }
  get chambers() { return this.features.filter(f => f.kind === 'chamber'); }
  feature(id) { return this.features.find(f => f.id === id); }
  room(role) { return this.features.find(f => f.kind === 'chamber' && f.role === role && f.started); }
  rooms(role) { return this.features.filter(f => f.kind === 'chamber' && f.role === role && f.started); }

  // ---------------------------------------------------------------- planning
  addFeature(f, cells, prio) {
    f.id = this.nextFeature++;
    f.cells = cells; f.prio = prio; f.done = false; f.started = false; f.stall = 0;
    for (const i of cells) if (this.own[i] === -1) this.own[i] = f.id;
    this.features.push(f);
    return f;
  }

  rasterCapsule(ax, ay, bx, by, w, rng) {
    const cells = [], prio = [];
    const r = w / 2, len = Math.hypot(bx - ax, by - ay) || 1;
    const c0 = Math.max(1, Math.floor((Math.min(ax, bx) - r) / CELL)), c1 = Math.min(COLS - 2, Math.ceil((Math.max(ax, bx) + r) / CELL));
    const r0 = Math.max(0, Math.floor((Math.min(ay, by) - r) / CELL)), r1 = Math.min(ROWS - 2, Math.ceil((Math.max(ay, by) + r) / CELL));
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      const px = col * CELL + CELL / 2, py = row * CELL + CELL / 2;
      const t = clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (len * len));
      const d = Math.hypot(px - (ax + (bx - ax) * t), py - (ay + (by - ay) * t));
      if (d <= r) { cells.push(row * COLS + col); prio.push(t * len + rng.next() * 3); }
    }
    return { cells, prio };
  }

  rasterChamber(x, y, rx, ry, ax, ay, rng) {
    const cells = [], prio = [];
    const p1 = rng.next() * 6.3, p2 = rng.next() * 6.3, p3 = rng.next() * 6.3;
    const a1 = rng.range(0.07, 0.15), a2 = rng.range(0.04, 0.09), a3 = rng.range(0.02, 0.05), tilt = rng.range(-0.07, 0.07);
    const c0 = Math.max(1, Math.floor((x - rx - 4) / CELL)), c1 = Math.min(COLS - 2, Math.ceil((x + rx + 4) / CELL));
    const r0 = Math.max(0, Math.floor((y - ry - 4) / CELL)), r1 = Math.min(ROWS - 2, Math.ceil((y + ry + 4) / CELL));
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      const px = col * CELL + CELL / 2, py = row * CELL + CELL / 2;
      const ly = py - y - tilt * (px - x);
      const dx = (px - x) / rx, dy = ly / (ly < 0 ? ry : ry * 0.55);
      const th = Math.atan2(dy, dx), rr = Math.hypot(dx, dy);
      const wobble = a1 * Math.sin(3 * th + p1) + a2 * Math.sin(5 * th + p2) + a3 * Math.sin(8 * th + p3);
      if (rr <= 1 + wobble * (ly < 0 ? 1 : 0.35)) {
        cells.push(row * COLS + col);
        prio.push(Math.hypot(px - ax, (py - ay) * 1.6) + rng.next() * 7);
      }
    }
    return { cells, prio };
  }

  // Reject shapes that would hit rock or merge into other parts of the nest.
  fits(cells, allowed, margin = 3, rockLimit = 0.06) {
    let rock = 0;
    for (const i of cells) if (this.grid[i] === ROCK) rock++;
    if (rock > cells.length * rockLimit) return false;
    const seen = new Set(cells);
    for (const i of cells) {
      const c = i % COLS, r = Math.floor(i / COLS);
      for (let dr = -margin; dr <= margin; dr++) for (let dc = -margin; dc <= margin; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0) continue;
        if (rr >= ROWS || cc < 0 || cc >= COLS) return false;
        const j = rr * COLS + cc;
        if (seen.has(j)) continue;
        const o = this.own[j];
        if (o !== -1 && !allowed.has(o)) return false;
      }
    }
    return true;
  }

  planShaftSegment(shaft, rng, len = 44, width = 12, spreadScale = 1) {
    const tip = shaft.pts[shaft.pts.length - 1];
    const allowed = new Set([...shaft.segments, ...(shaft.parent ? [shaft.parent] : [])]);
    let best = null;
    // Shafts wind from side to side, the way helical shafts look in a vertical cut.
    if (shaft.phase === undefined) { shaft.phase = rng.range(0, 6.3); shaft.amp = rng.range(0.3, 0.55); }
    const sway = shaft.amp * Math.sin(shaft.phase) * spreadScale;
    // A fresh branch sweeps a wide fan of headings, down to nearly horizontal.
    const branch = shaft.parent && !shaft.segments.length;
    const side = Math.sign(shaft.angle) || 1;
    const fan = [0, 0.2, -0.2, 0.4, 0.6, 0.8, 1.0, 1.2, -0.4, 1.35];
    for (let k = 0; k < (branch ? fan.length : 9); k++) {
      const spread = (k < 4 ? 0.18 : 0.8) * spreadScale;
      const ang = branch ? clamp(shaft.angle + side * fan[k], -1.4, 1.4)
        : clamp(sway + rng.range(-spread, spread) + (k > 5 ? rng.sign() * 0.6 : 0), -0.85, 0.85);
      const bx = tip.x + Math.sin(ang) * len, by = tip.y + Math.cos(ang) * len;
      if (bx < 30 || bx > W - 30 || by > SOIL_H - 30) continue;
      const { cells, prio } = this.rasterCapsule(tip.x, tip.y, bx, by, width, rng);
      const fresh = cells.filter((i, n) => (prio[n] > width * 0.5));
      if (!this.fits(fresh, allowed, 2, 0.02)) continue;
      best = { ang, bx, by, cells, prio }; break;
    }
    if (!best) { shaft.blocked = (shaft.blocked || 0) + 1; return null; }
    shaft.angle = best.ang;
    shaft.phase += rng.range(0.7, 1.3);
    const seg = this.addFeature({ kind: 'tunnel', shaft: shaft.id, from: { ...tip }, to: { x: best.bx, y: best.by } }, best.cells, best.prio);
    shaft.segments.push(seg.id);
    shaft.pts.push({ x: best.bx, y: best.by });
    return seg;
  }

  newShaft(start, angle, parent = null) {
    const shaft = { id: 1000 + this.shafts.length, pts: [start], angle, segments: [], parent, blocked: 0 };
    this.shafts.push(shaft);
    return shaft;
  }

  // x position of a completed shaft section at depth y
  shaftXAt(shaft, y) {
    for (let k = 0; k < shaft.segments.length; k++) {
      const seg = this.feature(shaft.segments[k]);
      if (!seg || !seg.done) return null;
      const a = shaft.pts[k], b = shaft.pts[k + 1];
      if (y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) {
        const t = (y - a.y) / ((b.y - a.y) || 1);
        return { x: lerp(a.x, b.x, t), seg: seg.id };
      }
    }
    return null;
  }

  planChamber(rng) {
    const candidates = [];
    for (const shaft of this.shafts) {
      const top = Math.max(shaft.pts[0].y + 34, shaft.parent ? 0 : 46);
      let tip = shaft.pts[0].y;
      shaft.segments.forEach((id, k) => { if (this.feature(id)?.done && tip === shaft.pts[k].y) tip = shaft.pts[k + 1].y; });
      for (let y = top; y < Math.min(SOIL_H - 30, tip - 22); y += 8) {
        const at = this.shaftXAt(shaft, y);
        if (!at) break;
        for (const side of [-1, 1]) candidates.push({ shaft, y, x: at.x, seg: at.seg, side, score: y + rng.next() * 70 });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    const rooms = this.chambers;
    let tries = 0;
    for (const c of candidates) {
      // Spacing between rooms on the same shaft grows with depth.
      const gap = 40 + c.y * 0.2;
      if (rooms.some(r => r.shaft === c.shaft.id && Math.abs(r.y - c.y) < (r.side === c.side ? gap : gap * 0.45))) continue;
      const depthT = clamp(c.y / SOIL_H);
      const rx = lerp(66, 26, Math.pow(depthT, 0.8)) * rng.range(0.8, 1.2);
      const ry = lerp(16, 9.5, depthT) * rng.range(0.9, 1.15);
      const allowed = new Set([...c.shaft.segments, ...(c.shaft.parent ? [c.shaft.parent] : [])]);
      const xa = c.x + c.side * 6, xb = c.x + c.side * (rx * 1.92 + 6 + 16);
      if (!this.clearBox(Math.min(xa, xb), c.y - ry - 16, Math.max(xa, xb), c.y + ry * 0.55 + 16, allowed)) continue;
      const room = this.tryChamber(c.shaft, c.x, c.y, c.side, rx, ry, rng);
      if (room) return room;
      if (++tries > 10) break;
    }
    return null;
  }

  clearBox(x0, y0, x1, y1, allowed) {
    const c0 = Math.floor(x0 / CELL), c1 = Math.floor(x1 / CELL), r0 = Math.floor(y0 / CELL), r1 = Math.floor(y1 / CELL);
    if (c0 < 1 || c1 >= COLS - 1 || r1 >= ROWS - 1) return false;
    for (let r = Math.max(0, r0); r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const o = this.own[r * COLS + c];
      if (o !== -1 && !allowed.has(o)) return false;
      if (this.grid[r * COLS + c] === ROCK && (r - r0) > 3 && (r1 - r) > 3) return false;
    }
    return true;
  }

  tryChamber(shaft, sx, y, side, rx, ry, rng) {
    const x = sx + side * (rx * 0.92 + 3);
    if (x - rx < 24 || x + rx > W - 24) return null;
    const { cells, prio } = this.rasterChamber(x, y, rx, ry, sx + side * 4, y, rng);
    if (!this.fits(cells, new Set([...shaft.segments, ...(shaft.parent ? [shaft.parent] : [])]), 4)) return null;
    return this.addFeature({ kind: 'chamber', x, y, rx, ry, side, shaft: shaft.id, role: 'dig' }, cells, prio);
  }

  planLobe(rng) {
    const rooms = this.chambers.filter(f => f.done && (f.lobes || 0) < (f.y < 260 ? 2 : 1) && !f.lobed);
    if (!rooms.length) return null;
    let roll = rng.next() * rooms.reduce((t, f) => t + 1 / (1 + f.y / 120), 0), room = rooms[0];
    for (const f of rooms) { roll -= 1 / (1 + f.y / 120); if (roll <= 0) { room = f; break; } }
    const side = room.side || rng.sign();
    const span = this.roomSpan(room);
    const end = side > 0 ? span.x1 : span.x0;
    const rx = room.rx * rng.range(0.4, 0.65), ry = room.ry * rng.range(0.7, 1.0);
    const x = end + side * rx * 0.55, y = room.y + rng.range(-5, 5);
    const done = () => { room.lobes = (room.lobes || 0) + 1; };
    if (x - rx < 24 || x + rx > W - 24) { room.lobed = true; return null; }
    const { cells, prio } = this.rasterChamber(x, y, rx, ry, end, y, rng);
    const own = new Set([room.id, ...this.features.filter(f => f.kind === 'lobe' && f.parent === room.id).map(f => f.id)]);
    const fresh = cells.filter(i => !own.has(this.own[i]));
    if (!this.fits(fresh, own, 3)) { room.lobed = true; return null; }
    done();
    return this.addFeature({ kind: 'lobe', parent: room.id, x, y, rx, ry }, cells, prio);
  }

  // Called periodically by the colony. Adds at most one new plan per call.
  plan(rng, need, maxActive) {
    const active = this.features.filter(f => !f.done);
    if (active.length >= maxActive || need <= 0) return null;
    const rooms = this.chambers;
    if (rooms.length >= 3 && rng.chance(0.3)) {
      const lobe = this.planLobe(rng);
      if (lobe) return lobe;
    }
    const room = this.planChamber(rng);
    if (room) return room;
    if (active.some(f => f.kind === 'tunnel')) return null;
    // Open side shafts as the nest grows: from a room's far end or off an existing shaft.
    const live = this.shafts.filter(sh => sh.blocked < 4 || sh.segments.length > 2).length;
    const wantShafts = 1 + Math.floor(rooms.length / 3);
    if (live < wantShafts) {
      for (let attempt = 0; attempt < 3; attempt++) {
        let start, angle, parent;
        const hosts = rooms.filter(r => r.done).sort((a, b) => a.y - b.y);
        if (hosts.length && rng.chance(0.55)) {
          const host = hosts[Math.min(hosts.length - 1, rng.int(Math.ceil(hosts.length * 0.6)))];
          const side = host.side || 1, span = this.roomSpan(host);
          start = { x: (side > 0 ? span.x1 : span.x0) - side * 6, y: host.y + host.ry * 0.3 };
          angle = side * rng.range(0.25, 0.6); parent = host.id;
        } else {
          const main = this.shafts[0], y = rng.range(70, Math.min(320, main.pts.at(-1).y - 30));
          const at = this.shaftXAt(main, y);
          if (!at) continue;
          const side = rng.sign();
          start = { x: at.x, y }; angle = side * rng.range(0.55, 0.8); parent = at.seg;
        }
        const shaft = this.newShaft(start, angle, parent);
        shaft.phase = Math.asin(clamp(angle / 0.6, -1, 1)); shaft.amp = 0.6;
        const seg = this.planShaftSegment(shaft, rng, 34, 11);
        if (seg) return seg;
        this.shafts.pop();
      }
    }
    const open = this.shafts.filter(s => s.blocked < 4 && s.pts[s.pts.length - 1].y < SOIL_H - 50);
    if (!open.length) return null;
    const shaft = rng.chance(0.6) ? open[0] : rng.pick(open);
    return this.planShaftSegment(shaft, rng, rng.range(26, 40), rng.range(11, 13));
  }

  // ---------------------------------------------------------------- digging
  touchesOpen(i) {
    const c = i % COLS, r = Math.floor(i / COLS);
    if (r === 0 && Math.abs(c - ENTRANCE_COL) <= 1) return true; // the surface itself
    return (c > 0 && this.grid[i - 1] === 0) || (c < COLS - 1 && this.grid[i + 1] === 0) ||
      (r > 0 && this.grid[i - COLS] === 0) || (r < ROWS - 1 && this.grid[i + COLS] === 0);
  }

  frontier(f) {
    const out = [];
    for (let n = 0; n < f.cells.length; n++) {
      const i = f.cells[n];
      const g = this.grid[i];
      if (g === 0 || g === ROCK || this.claims.has(i)) continue;
      if (this.touchesOpen(i)) out.push(n);
    }
    return out;
  }

  remaining(f) {
    let n = 0;
    for (const i of f.cells) if (this.grid[i] !== 0 && this.grid[i] !== ROCK) n++;
    return n;
  }

  // Choose a cell for an ant to dig. Returns { feature, cell, stand } or null.
  pickSite(rng, ant) {
    const active = this.features.filter(f => !f.done);
    if (!active.length) return null;
    const options = [];
    for (const f of active) {
      const fr = this.frontier(f);
      if (fr.length) options.push({ f, fr, w: Math.min(6, fr.length) * (f.kind === 'tunnel' ? 1.4 : 1) });
    }
    if (!options.length) return null;
    let roll = rng.next() * options.reduce((s, o) => s + o.w, 0), choice = options[0];
    for (const o of options) { roll -= o.w; if (roll <= 0) { choice = o; break; } }
    choice.fr.sort((a, b) => choice.f.prio[a] - choice.f.prio[b]);
    const n = choice.fr[Math.min(choice.fr.length - 1, rng.int(Math.min(4, choice.fr.length)))];
    const cell = choice.f.cells[n];
    const stand = this.standFor(cell);
    if (stand < 0 && !(Math.floor(cell / COLS) === 0)) return null;
    this.claims.set(cell, ant.id);
    choice.f.started = true;
    return { f: choice.f.id, cell, stand };
  }

  standFor(cell) {
    const c = cell % COLS;
    for (const d of [COLS, -1, 1, -COLS]) {
      const j = cell + d;
      if (j < 0 || j >= this.grid.length) continue;
      if ((d === -1 && c === 0) || (d === 1 && c === COLS - 1)) continue;
      if (this.grid[j] === 0) return j;
    }
    return -1;
  }

  release(cell) { this.claims.delete(cell); }

  // Excavate a pellet around `cell`. Returns the soil type of the pellet or 0.
  excavate(featureId, cell, amount, time) {
    const f = this.feature(featureId);
    this.claims.delete(cell);
    if (!f || this.grid[cell] === 0 || this.grid[cell] === ROCK) return 0;
    const type = this.soilType[cell];
    this.open(cell, time);
    let extra = amount - 1;
    if (extra > 0) {
      const set = new Set(f.cells);
      const queue = [cell - 1, cell + 1, cell - COLS, cell + COLS, cell - COLS - 1, cell - COLS + 1, cell + COLS - 1, cell + COLS + 1];
      for (const j of queue) {
        if (extra <= 0) break;
        if (set.has(j) && this.grid[j] !== 0 && this.grid[j] !== ROCK && !this.claims.has(j)) { this.open(j, time); extra--; }
      }
    }
    return type;
  }

  // Update completion state. Returns features that were just finished.
  settle(dt) {
    const finished = [];
    for (const f of this.features) {
      if (f.done) continue;
      const left = this.remaining(f);
      if (left === 0) { f.done = true; finished.push(f); continue; }
      if (this.frontier(f).length === 0 && ![...this.claims.keys()].some(i => this.own[i] === f.id || f.cells.includes(i))) {
        f.stall += dt;
        if (f.stall > 12) { f.done = true; f.blocked = true; finished.push(f); }
      } else f.stall = 0;
    }
    return finished;
  }

  // Dig a feature instantly (used when starting with an established colony).
  dig(f, time = 0) {
    for (const i of f.cells) this.open(i, time - 999);
    f.done = true; f.started = true;
  }

  // ---------------------------------------------------------------- rooms
  roomCells(room) {
    const own = new Set([room.id, ...this.features.filter(f => f.kind === 'lobe' && f.parent === room.id).map(f => f.id)]);
    const out = [];
    for (const f of this.features) if (own.has(f.id)) for (const i of f.cells) if (this.grid[i] === 0) out.push(i);
    return out;
  }

  // An open cell near the middle of a room's floor.
  roomAnchor(room) {
    // Keep a stable anchor once found (cells never refill), so navigation fields stay cached.
    if (room.anchor >= 0 && this.grid[room.anchor] === 0 && (room.done || room.anchorV === this.version)) return room.anchor;
    let best = -1, bd = Infinity;
    for (const i of room.cells) {
      if (this.grid[i] !== 0) continue;
      const d = Math.abs(cx(i) - room.x) + Math.abs(cy(i) - (room.y + room.ry * 0.2)) * 1.5;
      if (d < bd) { bd = d; best = i; }
    }
    room.anchor = best; room.anchorV = this.version;
    return best;
  }

  // Floor line of a room: x range and floor y at a given x.
  floorY(x, room) {
    let c = Math.floor(x / CELL);
    let r = Math.floor((room.y) / CELL);
    if (this.grid[r * COLS + c] !== 0) {
      for (let k = -3; k <= 3; k++) if (this.grid[(r + k) * COLS + c] === 0) { r = r + k; break; }
    }
    if (this.grid[r * COLS + c] !== 0) return room.y + room.ry * 0.5;
    while (r < ROWS - 1 && this.grid[(r + 1) * COLS + c] === 0) r++;
    return (r + 1) * CELL;
  }

  roomSpan(room) {
    let lo = Infinity, hi = -Infinity;
    for (const f of this.features) {
      if (f.id !== room.id && !(f.kind === 'lobe' && f.parent === room.id)) continue;
      for (const i of f.cells) if (this.grid[i] === 0) {
        const x = cx(i);
        if (Math.abs(cy(i) - f.y) < f.ry) { if (x < lo) lo = x; if (x > hi) hi = x; }
      }
    }
    if (lo > hi) return { x0: room.x - 4, x1: room.x + 4, empty: true };
    return { x0: lo, x1: hi };
  }

  // ---------------------------------------------------------------- navigation
  // Distance-to-target field over open cells. Opening cells only shortens paths,
  // so stale fields stay valid for ants already in mapped cells.
  field(target, time, force = false) {
    let e = this.fields.get(target);
    if (e && (e.version === this.version || (!force && time - e.time < 8))) { e.used = time; return e.d; }
    if (e && force && time - e.time < 0.4) return e.d;
    const d = e ? e.d : new Float32Array(COLS * ROWS);
    d.fill(Infinity);
    if (this.grid[target] === 0) {
      const heap = new Heap();
      d[target] = 0; heap.push(target, 0);
      while (heap.size) {
        const i = heap.pop();
        const di = d[i], c = i % COLS, r = (i - c) / COLS;
        for (const [dc, dr, w] of N8) {
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
          const j = rr * COLS + cc;
          if (this.grid[j] !== 0) continue;
          if (dc && dr && (this.grid[r * COLS + cc] !== 0 || this.grid[rr * COLS + c] !== 0)) continue;
          const nd = di + w;
          if (nd < d[j]) { d[j] = nd; heap.push(j, nd); }
        }
      }
    }
    if (!e) {
      if (this.fields.size > 48) {
        let old = null, ot = Infinity;
        for (const [k, v] of this.fields) if (v.used < ot && k !== this.entranceCell) { ot = v.used; old = k; }
        if (old !== null) this.fields.delete(old);
      }
      e = { d };
      this.fields.set(target, e);
    }
    e.version = this.version; e.time = time; e.used = time;
    return d;
  }

  get entranceCell() { return ENTRANCE_COL; }

  // ---------------------------------------------------------------- persistence
  serialize() {
    const open = [];
    let run = 0, state = 0;
    for (let i = 0; i < this.grid.length; i++) {
      const v = this.grid[i] === 0 ? 1 : 0;
      if (v === state) run++; else { open.push(run); run = 1; state = v; }
    }
    open.push(run);
    return {
      open,
      features: this.features.map(f => ({ ...f, cells: undefined, prio: undefined, anchor: undefined, anchorV: undefined, c: Array.from(f.cells), p: Array.from(f.prio, v => Math.round(v * 10) / 10) })),
      shafts: this.shafts, nextFeature: this.nextFeature, roleCycle: this.roleCycle,
    };
  }

  restore(data) {
    let i = 0, state = 0;
    for (const run of data.open) {
      if (state) for (let k = 0; k < run; k++) { if (this.grid[i + k] !== 0) { this.grid[i + k] = 0; this.openCount++; const c = (i + k) % COLS, r = Math.floor((i + k) / COLS), b = this.bounds; b.c0 = Math.min(b.c0, c); b.c1 = Math.max(b.c1, c); b.r0 = Math.min(b.r0, r); b.r1 = Math.max(b.r1, r); } }
      i += run; state = 1 - state;
    }
    this.features = data.features.map(f => {
      const g = { ...f, cells: f.c, prio: f.p };
      delete g.c; delete g.p;
      for (const j of g.cells) if (this.own[j] === -1) this.own[j] = g.id;
      return g;
    });
    this.shafts = data.shafts; this.nextFeature = data.nextFeature; this.roleCycle = data.roleCycle || 0;
    this.version++;
  }
}
