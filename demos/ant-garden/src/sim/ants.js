// Individual ant behaviour. Each worker picks a task from what the colony
// currently needs (space, food, brood care) weighted by its age and experience,
// then runs that task as a small state machine.
import { W, SURF_D, CELL, COLS, ENTRANCE, ENTRANCE_COL, MIDDEN, FOODS, HARDNESS, DAY } from './config.js';
import { cellOf, cx, cy } from './nest.js';
import { clamp, angleDiff } from './rng.js';

const TAU = Math.PI * 2;
const NEST_SPEED = 19, SURF_SPEED = 25;
const N8 = [1, -1, COLS, -COLS, COLS + 1, COLS - 1, -COLS + 1, -COLS - 1];

export function makeAnt(col, opts = {}) {
  const r = col.rng;
  const queen = opts.caste === 'queen';
  const alate = opts.caste === 'gyne' || opts.caste === 'male';
  return {
    id: col.nextAnt++, caste: opts.caste || 'worker', loc: opts.loc || 'nest',
    x: opts.x ?? 0, y: opts.y ?? 0, z: opts.z ?? 0, h: opts.h ?? r.range(0, TAU), v: 0,
    age: opts.age ?? 0, life: queen ? Infinity : DAY * (alate ? 40 : r.range(18, 30)), energy: r.range(0.7, 1),
    callow: opts.callow ?? 0, size: queen || alate ? 1 : r.range(0.9, 1.08),
    task: queen ? 'queen' : alate ? 'alate' : 'rest', st: queen ? 'stay' : 'go', t: 0, n: 0,
    cargo: null, crop: 0, site: null, mem: null, rec: null, dest: -1, spot: -1, tx: 0, tz: 0,
    lane: r.range(-1, 1), gait: r.range(0, TAU), stuck: 0, search: 0, pher: 0,
    bias: { nurse: r.range(0.7, 1.3), dig: r.range(0.7, 1.3), forage: r.range(0.7, 1.3) },
    exp: { nurse: 0, dig: 0, forage: 0 }, done: { food: 0, soil: 0, care: 0 },
    wings: alate || (queen && !!opts.wings), alt: 0, reserve: queen ? (opts.reserve ?? 0) : 0, lay: 10,
  };
}

// ------------------------------------------------------------------ movement
function turnToward(a, want, rate, dt) {
  const d = angleDiff(a.h, want);
  const m = rate * dt;
  a.h += d > m ? m : d < -m ? -m : d;
  return Math.abs(d);
}

function speedOf(a, surface) {
  let s = surface ? SURF_SPEED : NEST_SPEED;
  if (a.caste === 'queen') s *= 0.5;
  if (a.cargo) s *= a.cargo.k === 'brood' || a.cargo.k === 'corpse' ? 0.75 : 0.85;
  if (a.callow > 0) s *= 0.7;
  if (a.energy < 0.15) s *= 0.6;
  return s * a.size;
}

function moved(a, dist) { a.gait += dist * 0.55; a.v = dist; }

// Step toward a point inside the nest, sliding along walls.
function stepNest(col, a, tx, ty, dt, speed) {
  const nest = col.nest;
  const want = Math.atan2(ty - a.y, tx - a.x);
  const off = turnToward(a, want, 8, dt);
  const sp = speed * (off > 1.6 ? 0.35 : off > 0.8 ? 0.7 : 1) * dt;
  const remain = Math.hypot(tx - a.x, ty - a.y);
  const step = Math.min(sp, remain);
  let nx = a.x + Math.cos(a.h) * step, ny = a.y + Math.sin(a.h) * step;
  if (nest.openAt(nx, ny)) { a.x = nx; a.y = ny; moved(a, step); a.stuck = 0; return; }
  if (nest.openAt(nx, a.y)) { a.x = nx; moved(a, step * 0.7); return; }
  if (nest.openAt(a.x, ny)) { a.y = ny; moved(a, step * 0.7); return; }
  // Fall back to moving straight at the (open) target point.
  const k = step / (remain || 1);
  nx = a.x + (tx - a.x) * k; ny = a.y + (ty - a.y) * k;
  if (nest.openAt(nx, ny)) { a.x = nx; a.y = ny; moved(a, step); } else a.stuck += dt;
}

function snapIntoNest(col, a) {
  const nest = col.nest;
  const c0 = cellOf(a.x, a.y);
  if (nest.isOpen(c0)) return c0;
  let best = -1, bd = Infinity;
  const col0 = Math.floor(a.x / CELL), row0 = Math.floor(a.y / CELL);
  for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
    const r = row0 + dr, c = col0 + dc;
    if (r < 0 || c < 0 || c >= COLS) continue;
    const i = r * COLS + c;
    if (!nest.isOpen(i)) continue;
    const d = dr * dr + dc * dc;
    if (d < bd) { bd = d; best = i; }
  }
  if (best >= 0) { a.x = cx(best); a.y = cy(best); }
  return best;
}

// Follow a distance field toward `target`. Returns true on arrival.
function navTo(col, a, target, dt, arrive = 1.6) {
  const nest = col.nest;
  if (target < 0 || !nest.isOpen(target)) { a.stuck += dt; return false; }
  let ci = snapIntoNest(col, a);
  if (ci < 0) { a.stuck += dt; return false; }
  let d = nest.field(target, col.time);
  if (d[ci] === Infinity) {
    d = nest.field(target, col.time, true);
    if (d[ci] === Infinity) { a.stuck += dt; return false; }
  }
  // Progress watchdog: oscillating at a junction counts as being stuck.
  if (a.navTarget !== target) { a.navTarget = target; a.navBest = Infinity; a.navT = 0; }
  if (d[ci] < a.navBest - 0.5) { a.navBest = d[ci]; a.navT = 0; } else a.navT += dt;
  if (a.navT > 12) { a.navT = 0; a.navBest = Infinity; a.stuck = 7; return false; }
  const direct = a.navT > 2;
  if (d[ci] <= arrive) {
    const tx = cx(target), ty = cy(target);
    if (arrive > 2 || Math.hypot(tx - a.x, ty - a.y) < 2.5) { a.stuck = 0; return true; }
    stepNest(col, a, tx, ty, dt, speedOf(a, false));
    return false;
  }
  let j = ci;
  for (let k = 0; k < (direct ? 1 : 3); k++) {
    let best = j, bd = d[j];
    const c = j % COLS;
    for (let n = 0; n < 8; n++) {
      const off = N8[n], m = j + off;
      const dc = n === 0 || n === 4 || n === 6 ? 1 : n === 1 || n === 5 || n === 7 ? -1 : 0;
      if (c + dc < 0 || c + dc >= COLS || m < 0 || m >= d.length) continue;
      if (d[m] < bd) {
        if (n >= 4 && (!nest.isOpen(j + dc) || !nest.isOpen(m - dc))) continue;
        bd = d[m]; best = m;
      }
    }
    if (best === j) break;
    j = best;
  }
  let tx = cx(j), ty = cy(j);
  const dx = tx - a.x, dy = ty - a.y, len = Math.hypot(dx, dy) || 1;
  const ox = tx - (dy / len) * a.lane * 2.2, oy = ty + (dx / len) * a.lane * 2.2;
  if (!direct && nest.openAt(ox, oy)) { tx = ox; ty = oy; }
  stepNest(col, a, tx, ty, dt, speedOf(a, false));
  return false;
}

// Wander locally to a spot inside a room (rooms are roughly convex).
function strollTo(col, a, dt) {
  if (a.spot < 0) return true;
  const tx = cx(a.spot), ty = cy(a.spot);
  if (Math.hypot(tx - a.x, ty - a.y) < 2.5) return true;
  stepNest(col, a, tx, ty, dt, speedOf(a, false) * 0.55);
  if (a.stuck > 1.2) { a.stuck = 0; return true; }
  return false;
}

function stepSurface(col, a, want, dt, speed) {
  const s = col.surface;
  turnToward(a, want, 6, dt);
  const step = speed * dt;
  let nx = a.x + Math.cos(a.h) * step, nz = a.z + Math.sin(a.h) * step;
  if (nx < 8 || nx > W - 8 || nz < 3 || nz > SURF_D - 6) {
    a.h = Math.atan2(SURF_D * 0.5 - a.z, W * 0.5 - a.x) + col.rng.range(-0.7, 0.7);
    return;
  }
  const o = s.blocked(nx, nz, 2.5);
  if (o) {
    const out = Math.atan2(a.z - o.z, a.x - o.x);
    const t1 = out + Math.PI / 2, t2 = out - Math.PI / 2;
    a.h = Math.abs(angleDiff(a.h, t1)) < Math.abs(angleDiff(a.h, t2)) ? t1 : t2;
    nx = o.x + Math.cos(out) * (o.r + 2.6) + Math.cos(a.h) * step;
    nz = o.z + Math.sin(out) * (o.r + 2.6) + Math.sin(a.h) * step;
  }
  moved(a, Math.hypot(nx - a.x, nz - a.z));
  a.x = nx; a.z = nz;
}

function goToward(col, a, x, z, dt, slow = 1) {
  const d = Math.hypot(x - a.x, z - a.z);
  if (d < 2.5) return true;
  const want = Math.atan2(z - a.z, x - a.x) + (d > 20 ? col.rng.gauss() * 0.08 : 0);
  stepSurface(col, a, want, dt, Math.min(speedOf(a, true) * slow, d / dt));
  return false;
}

function exitNest(col, a) {
  a.loc = 'surface'; a.x = ENTRANCE.x + col.rng.range(-2, 2); a.z = ENTRANCE.z + 2;
  a.h = col.rng.range(0.25, Math.PI - 0.25); a.search = 0; a.stuck = 0;
}
function enterNest(col, a) {
  a.loc = 'nest'; a.x = ENTRANCE.x; a.y = 2; a.h = Math.PI / 2; a.stuck = 0;
}
const atEntrance = a => Math.hypot(a.x - ENTRANCE.x, a.z - ENTRANCE.z) < 4;

// Head for the nest entrance, either inside the nest or on the surface.
function headOut(col, a, dt) {
  if (a.loc === 'surface') return true;
  if (navTo(col, a, ENTRANCE_COL, dt, 1.2)) { exitNest(col, a); return true; }
  return false;
}
function headIn(col, a, dt) {
  if (a.loc === 'nest') return true;
  if (!col.nest.isOpen(ENTRANCE_COL)) return goToward(col, a, ENTRANCE.x, ENTRANCE.z, dt);
  if (goToward(col, a, ENTRANCE.x, ENTRANCE.z, dt) || atEntrance(a)) { enterNest(col, a); return true; }
  return false;
}

// ------------------------------------------------------------------ rooms
export function roomOpenCells(col, room) {
  if (room._v !== col.nest.version) { room._open = col.nest.roomCells(room); room._v = col.nest.version; }
  return room._open;
}
function pickSpot(col, room) {
  const cells = roomOpenCells(col, room);
  if (!cells.length) return -1;
  // Prefer the floor so resting ants stand on the ground.
  for (let k = 0; k < 6; k++) {
    const i = col.rng.pick(cells);
    if (!col.nest.isOpen(i + COLS)) return i;
  }
  return col.rng.pick(cells);
}
function roomOf(col, a) {
  if (a.loc !== 'nest') return null;
  const i = cellOf(a.x, a.y), own = col.nest.own[i];
  if (own < 0) return null;
  const f = col.nest.feature(own);
  if (!f) return null;
  if (f.kind === 'lobe') return col.nest.feature(f.parent);
  return f.kind === 'chamber' ? f : null;
}

// ------------------------------------------------------------------ tasks
export function chooseTask(col, a) {
  if (a.site) { col.nest.release(a.site.cell); a.site = null; }
  a.t = 0; a.n = 0; a.stuck = 0; a.spot = -1; a.dest = -1;
  if (a.caste === 'queen') { setTask(a, 'queen', 'stay'); return; }
  if (a.caste === 'gyne' || a.caste === 'male') { setTask(a, 'alate', 'go'); return; }
  const need = col.needs, r = col.rng, life = a.age / a.life;
  if (a.callow > 0) { setTask(a, r.chance(0.6) && need.brood > 0 ? 'nurse' : 'rest', 'go'); return; }
  const pref = {
    nurse: life < 0.25 ? 1.0 : life < 0.5 ? 0.45 : 0.12,
    dig: life < 0.12 ? 0.35 : life < 0.65 ? 1.0 : 0.55,
    forage: life < 0.2 ? 0.12 : life < 0.45 ? 0.65 : 1.0,
  };
  const score = {
    nurse: need.nurse * pref.nurse * a.bias.nurse * (1 + Math.min(0.6, a.exp.nurse * 0.02)),
    dig: need.dig * pref.dig * a.bias.dig * (1 + Math.min(0.6, a.exp.dig * 0.01)),
    forage: need.forage * pref.forage * a.bias.forage * (1 + Math.min(0.6, a.exp.forage * 0.02)),
    undertake: need.undertake * (life > 0.3 ? 0.5 : 0.15),
    rest: 0.16 + (a.energy < 0.3 ? 0.4 : 0),
  };
  if (col.counts.dig >= need.digCap) score.dig *= 0.05;
  if (col.counts.undertake >= need.undertakeCap) score.undertake = 0;
  let total = 0;
  for (const k in score) { score[k] = score[k] * score[k]; total += score[k]; }
  let roll = r.next() * total, task = 'rest';
  for (const k in score) { roll -= score[k]; if (roll <= 0) { task = k; break; } }
  const first = { nurse: 'go', dig: 'pick', forage: 'out', undertake: 'go', rest: 'go' };
  setTask(a, task, first[task]);
  if (task === 'forage') { a.search = 0; a.n = 0; }
}

function setTask(a, task, st) {
  a.task = task; a.st = st; a.t = 0;
}

// ------------------------------------------------------------------ update
export function updateAnt(col, a, dt) {
  a.age += dt;
  if (a.callow > 0) a.callow -= dt;
  if (a.loc === 'air') { fly(col, a, dt); return; }
  a.energy -= (dt / (DAY * (a.caste === 'queen' ? 1.4 : 0.75))) * (1 - 0.65 * col.cold);
  if (a.loc === 'nest' && a.energy < 0.55) eat(col, a);
  if (a.energy < -0.25 || a.age > a.life) { a.dead = a.energy < -0.25 ? 'starved' : 'old'; return; }
  a.v = 0;
  switch (a.task) {
    case 'dig': dig(col, a, dt); break;
    case 'forage': forage(col, a, dt); break;
    case 'nurse': nurse(col, a, dt); break;
    case 'undertake': undertake(col, a, dt); break;
    case 'queen': queen(col, a, dt); break;
    case 'move': moveQueen(col, a, dt); break;
    case 'found': found(col, a, dt); break;
    case 'alate': rest(col, a, dt); break;
    case 'fly': fly(col, a, dt); break;
    case 'guard': guard(col, a, dt); break;
    default: rest(col, a, dt);
  }
  if (a.stuck > 6) { a.stuck = 0; dropCargo(col, a); chooseTask(col, a); }
}

function eat(col, a) {
  const s = col.stores, need = 1 - a.energy;
  const cost = need * 0.7;
  if (s.sugar >= cost) { s.sugar -= cost; a.energy = 1; return; }
  if (s.protein >= cost) { s.protein -= cost; a.energy = 1; return; }
  if (s.seeds >= cost * 1.2) { s.seeds -= cost * 1.2; a.energy = 1; return; }
  if (a.caste === 'queen' && a.reserve > 0.1) { a.reserve -= 0.1; a.energy += 0.15; }
}

export function dropCargo(col, a) {
  if (!a.cargo) return;
  if (a.site) { col.nest.release(a.site.cell); }
  if (a.cargo.k === 'brood') {
    const b = col.brood.find(q => q.id === a.cargo.b);
    if (b) { b.carried = 0; const room = roomOf(col, a); if (room) b.room = room.id; }
  } else if (a.cargo.k === 'corpse') {
    col.corpses.push({ id: col.nextCorpse++, loc: a.loc, x: a.x, y: a.y, z: a.z, claimed: 0 });
  }
  a.cargo = null;
}

// ------------------------------------------------------------------ digging
function dig(col, a, dt) {
  const nest = col.nest;
  switch (a.st) {
    case 'pick': {
      if (a.loc === 'surface' && nest.isOpen(ENTRANCE_COL)) { headIn(col, a, dt); return; }
      const site = nest.pickSite(col.rng, a);
      if (!site) {
        if (a.caste === 'queen') { a.t += dt; if (a.t > 1) { a.t = 0; } return; }
        chooseTask(col, a); return;
      }
      a.site = site; a.st = 'go'; a.t = 0;
      return;
    }
    case 'go': {
      const site = a.site;
      if (!site || nest.isOpen(site.cell)) { if (site) nest.release(site.cell); a.site = null; a.st = 'pick'; return; }
      a.t += dt;
      if (a.t > 60) { nest.release(site.cell); a.site = null; chooseTask(col, a); return; }
      if (site.stand < 0) {
        // Breaking ground from the surface (only at the very start of a nest).
        if (a.loc === 'nest') { if (headOut(col, a, dt)) return; return; }
        if (goToward(col, a, ENTRANCE.x, ENTRANCE.z, dt)) { a.st = 'dig'; a.t = digTime(col, a, site.cell); }
        return;
      }
      if (a.loc === 'surface') { headIn(col, a, dt); return; }
      if (navTo(col, a, site.stand, dt, 0.6)) {
        a.st = 'dig'; a.t = digTime(col, a, site.cell);
        a.h = Math.atan2(cy(site.cell) - a.y, cx(site.cell) - a.x);
      }
      return;
    }
    case 'dig': {
      a.t -= dt;
      if (a.loc === 'nest') turnToward(a, Math.atan2(cy(a.site.cell) - a.y, cx(a.site.cell) - a.x), 6, dt);
      a.gait += dt * 2.2;
      if (a.t > 0) return;
      const type = nest.excavate(a.site.f, a.site.cell, a.caste === 'queen' ? 6 : 4, col.time);
      if (!type) { a.site = null; a.st = 'pick'; return; }
      col.fx.push({ k: 'dig', x: cx(a.site.cell), y: cy(a.site.cell), s: type });
      a.cargo = { k: 'soil', s: type };
      a.site = null; a.exp.dig++; a.done.soil++; col.stats.pellets++;
      a.st = 'out';
      return;
    }
    case 'out': {
      if (!headOut(col, a, dt)) return;
      const r = col.rng, around = col.surface.height(ENTRANCE.x, ENTRANCE.z + 14);
      const ang = r.chance(0.8) ? r.range(0.1, Math.PI - 0.1) : r.range(-0.3, Math.PI + 0.3);
      const dist = 13 + r.next() * 18 + Math.min(40, around * 1.4) + Math.abs(r.gauss()) * 5;
      a.tx = clamp(ENTRANCE.x + Math.cos(ang) * dist * 1.25, 10, W - 10);
      a.tz = clamp(ENTRANCE.z + Math.sin(ang) * dist, 3, SURF_D - 8);
      a.st = 'dump';
      return;
    }
    case 'dump': {
      if (!goToward(col, a, a.tx, a.tz, dt)) return;
      const h = col.surface.height(a.x, a.z);
      col.surface.depositSoil(a.x, a.z);
      col.fx.push({ k: 'grain', x: a.x, z: a.z, h, s: a.cargo?.s || 2 });
      a.cargo = null; a.st = 'back';
      return;
    }
    case 'back': {
      if (!headIn(col, a, dt)) return;
      if (a.caste === 'queen' || (col.needs.dig > 0.05 && a.energy > 0.25 && col.rng.chance(0.82))) a.st = 'pick';
      else chooseTask(col, a);
      return;
    }
  }
}

function digTime(col, a, cell) {
  const hard = HARDNESS[col.nest.soilType[cell]] || 1;
  return (2.0 + col.rng.next() * 1.4) * hard * (a.caste === 'queen' ? 1.25 : 1);
}

// ------------------------------------------------------------------ foraging
function scentRange(f) {
  const spec = FOODS[f.type];
  return spec.scent * (0.55 + 0.45 * Math.sqrt(f.amount / f.max));
}
function foodRadius(f) {
  const spec = FOODS[f.type];
  return spec.radius * (0.55 + 0.45 * Math.sqrt(Math.max(0, f.amount) / f.max));
}

function senseFood(col, a, dt) {
  let best = null, bd = Infinity;
  for (const f of col.surface.foods) {
    if (f.amount <= 0) continue;
    const d = Math.hypot(f.x - a.x, f.z - a.z), range = scentRange(f);
    if (d > range) continue;
    if (d > range * 0.55 && !col.rng.chance(1.6 * dt)) continue;
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

function followTrail(col, a) {
  const s = col.surface, look = 13;
  let bestAng = 0, best = 0.06;
  const awayX = a.x - ENTRANCE.x, awayZ = a.z - ENTRANCE.z, al = Math.hypot(awayX, awayZ) || 1;
  for (const off of [-0.55, 0, 0.55]) {
    const ang = a.h + off;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    let v = s.sample(a.x + dx * look, a.z + dz * look);
    const out = (dx * awayX + dz * awayZ) / al;
    if (out < -0.15) v *= 0.15;          // trails lead away from home when outbound
    if (off === 0) v *= 1.15;
    if (v > best) { best = v; bestAng = off; }
  }
  return best > 0.06 ? a.h + bestAng : null;
}

function forage(col, a, dt) {
  const r = col.rng, s = col.surface;
  switch (a.st) {
    case 'out': {
      if (!headOut(col, a, dt)) return;
      a.st = 'search'; a.search = 0;
      return;
    }
    case 'search': {
      a.search += dt;
      const f = senseFood(col, a, dt);
      if (f) { a.st = 'approach'; a.dest = f.id; a.rec = null; return; }
      let want = a.h + r.gauss() * 1.5 * Math.sqrt(dt);
      if (a.mem) {
        const d = Math.hypot(a.mem.x - a.x, a.mem.z - a.z);
        if (d < 10) { a.mem.miss = (a.mem.miss || 0) + dt; if (a.mem.miss > 6) a.mem = null; }
        else want = Math.atan2(a.mem.z - a.z, a.mem.x - a.x) + r.gauss() * 0.12;
      } else {
        const trail = followTrail(col, a);
        if (trail !== null) want = trail + r.gauss() * 0.1;
        else if (a.rec) {
          const d = Math.hypot(a.rec.x - a.x, a.rec.z - a.z);
          if (d < 14) a.rec = null; else want = Math.atan2(a.rec.z - a.z, a.rec.x - a.x) + r.gauss() * 0.35;
        } else {
          const home = Math.hypot(a.x - ENTRANCE.x, a.z - ENTRANCE.z);
          if (home < 40) want += angleDiff(a.h, Math.atan2(a.z - ENTRANCE.z, a.x - ENTRANCE.x)) * 0.05;
        }
      }
      stepSurface(col, a, want, dt, speedOf(a, true));
      const patience = 70 + a.bias.forage * 30 + (col.night ? -25 : 0);
      if (a.search > patience || a.energy < 0.12 || col.cold > 0.7) { a.st = 'return'; a.mem = null; }
      return;
    }
    case 'approach': {
      const f = s.foods.find(q => q.id === a.dest && q.amount > 0);
      if (!f) { a.st = 'search'; return; }
      const ang = (a.id * 2.39996) % TAU, rad = foodRadius(f) + 2;
      const px = f.x + Math.cos(ang) * rad, pz = f.z + Math.sin(ang) * rad * 0.9;
      if (goToward(col, a, px, pz, dt, 0.8)) {
        a.st = 'harvest'; a.t = FOODS[f.type].harvest * r.range(0.8, 1.25);
        a.h = Math.atan2(f.z - a.z, f.x - a.x);
        if (!f.found) {
          f.found = true;
          col.say(`働きアリが${FOODS[f.type].name}を見つけました`, 'food');
        }
      }
      return;
    }
    case 'harvest': {
      const f = s.foods.find(q => q.id === a.dest && q.amount > 0);
      if (!f) { a.st = 'search'; return; }
      a.t -= dt; a.gait += dt * 1.5;
      const kind = FOODS[f.type].kind;
      if (kind === 'sugar') a.crop = Math.min(1, a.crop + dt / FOODS[f.type].harvest);
      if (a.t > 0) return;
      f.amount -= 1;
      a.rich = clamp(f.amount / 14, 0.25, 1);
      a.mem = { x: f.x, z: f.z, id: f.id };
      if (kind === 'sugar') { a.cargo = { k: 'sugar' }; a.crop = 1; a.energy = 1; }
      else a.cargo = { k: kind === 'seed' ? 'seed' : 'meat' };
      if (f.amount <= 0) col.foodGone(f);
      a.st = 'home'; a.pher = 0;
      return;
    }
    case 'home': {
      a.pher -= dt;
      if (a.pher <= 0) { a.pher = 0.3; s.deposit(a.x, a.z, 0.55 * (a.rich || 0.5)); }
      if (!headIn(col, a, dt)) return;
      a.st = 'store'; a.dest = -1;
      return;
    }
    case 'return': {
      if (!headIn(col, a, dt)) return;
      chooseTask(col, a);
      return;
    }
    case 'store': {
      const room = col.foodRoom();
      const target = room ? col.nest.roomAnchor(room) : ENTRANCE_COL;
      if (target >= 0 && !navTo(col, a, target, dt, 4)) return;
      const k = a.cargo?.k;
      if (k === 'sugar') { col.stores.sugar += 1; col.stats.sugar++; a.crop = 0; }
      else if (k === 'meat') { col.stores.protein += 1; col.stats.protein++; }
      else if (k === 'seed') { col.stores.seeds += 1; col.stats.seeds++; }
      a.cargo = null; a.exp.forage++; a.done.food++; a.n++;
      const f = a.mem && s.foods.find(q => q.id === a.mem.id && q.amount > 0);
      if (f) col.recruit(a, f);
      if (f && a.n < 4 + col.needs.hunger * 12 && a.energy > 0.2 && (!col.night || r.chance(0.5))) { a.st = 'out'; a.search = 0; }
      else { a.mem = f ? a.mem : null; chooseTask(col, a); }
      return;
    }
  }
}

// ------------------------------------------------------------------ brood care
function nurse(col, a, dt) {
  const r = col.rng;
  switch (a.st) {
    case 'go': {
      if (a.loc === 'surface') { headIn(col, a, dt); return; }
      if (a.dest < 0) {
        const job = col.broodJob(a);
        if (!job) { chooseTask(col, a); return; }
        if (job.fetch) { a.cargo = null; a.tx = job.fetch; a.tz = job.to; a.st = 'fetch'; a.dest = col.nest.roomAnchor(col.nest.feature(job.from)); a.n = job.from; return; }
        a.n = job.room; a.dest = col.nest.roomAnchor(col.nest.feature(job.room));
        if (a.dest < 0) { chooseTask(col, a); return; }
      }
      if (navTo(col, a, a.dest, dt, 4)) {
        a.st = 'tend'; a.t = r.range(2.5, 4.5); a.spot = -1;
        const b = col.hungriest(a.n);
        if (b) { const p = col.broodPos(b); if (p) a.h = Math.atan2(p.y - a.y, p.x - a.x); }
      }
      return;
    }
    case 'tend': {
      a.t -= dt; a.gait += dt * 0.6;
      if (a.t > 0) return;
      const fed = col.feedLarva(a.n);
      if (fed) { a.exp.nurse++; a.done.care++; }
      a.dest = -1; a.st = 'go';
      if (!fed || r.chance(0.25)) chooseTask(col, a);
      return;
    }
    case 'fetch': {
      const b = col.brood.find(q => q.id === a.tx && !q.carried);
      if (!b) { a.dest = -1; a.st = 'go'; chooseTask(col, a); return; }
      if (!navTo(col, a, a.dest, dt, 4)) return;
      b.carried = a.id; a.cargo = { k: 'brood', b: b.id, stage: b.stage };
      a.dest = col.nest.roomAnchor(col.nest.feature(a.tz)); a.st = 'carry';
      return;
    }
    case 'carry': {
      if (a.dest < 0 || !navTo(col, a, a.dest, dt, 4)) { if (a.dest < 0) { dropCargo(col, a); chooseTask(col, a); } return; }
      const b = col.brood.find(q => q.id === a.cargo?.b);
      if (b) { b.carried = 0; b.room = a.tz; b.slot = col.rng.next(); }
      a.cargo = null; a.done.care++; a.exp.nurse++;
      a.dest = -1; a.st = 'go';
      if (r.chance(0.3)) chooseTask(col, a);
      return;
    }
  }
}

// ------------------------------------------------------------------ resting
function rest(col, a, dt) {
  switch (a.st) {
    case 'go': {
      if (a.loc === 'surface') { headIn(col, a, dt); return; }
      if (a.dest < 0) {
        const room = col.restRoom(a);
        if (!room) { a.st = 'idle'; a.t = 5; return; }
        a.n = room.id; a.dest = col.nest.roomAnchor(room);
        if (a.dest < 0) { a.st = 'idle'; a.t = 5; return; }
      }
      if (navTo(col, a, a.dest, dt, 5)) { a.st = 'idle'; a.t = col.rng.range(8, 24) * (1 + 2 * col.cold); a.spot = -1; }
      return;
    }
    case 'idle': {
      a.t -= dt;
      if (a.spot >= 0) { if (strollTo(col, a, dt)) a.spot = -1; }
      else if (col.rng.chance(0.25 * dt)) {
        const room = col.nest.feature(a.n);
        if (room) a.spot = pickSpot(col, room);
      } else if (col.rng.chance(0.4 * dt)) a.h += col.rng.range(-0.8, 0.8);
      if (a.t <= 0) chooseTask(col, a);
      return;
    }
  }
}

// ------------------------------------------------------------------ undertaking
function undertake(col, a, dt) {
  switch (a.st) {
    case 'go': {
      let c = col.corpses.find(q => q.claimed === a.id);
      if (!c) {
        c = col.corpses.find(q => !q.claimed);
        if (!c) { chooseTask(col, a); return; }
        c.claimed = a.id;
      }
      if (c.loc === 'nest') {
        if (a.loc === 'surface') { headIn(col, a, dt); return; }
        const cell = cellOf(c.x, c.y);
        if (!col.nest.isOpen(cell) || navTo(col, a, cell, dt, 1.5)) pickCorpse(col, a, c);
      } else {
        if (a.loc === 'nest') { headOut(col, a, dt); return; }
        if (goToward(col, a, c.x, c.z, dt)) pickCorpse(col, a, c);
      }
      return;
    }
    case 'carry': {
      if (!headOut(col, a, dt)) return;
      if (!a.tx) { a.tx = MIDDEN.x + col.rng.gauss() * 10; a.tz = MIDDEN.z + col.rng.gauss() * 6; }
      if (!goToward(col, a, a.tx, a.tz, dt)) return;
      col.surface.midden++;
      col.fx.push({ k: 'corpse', x: a.x, z: a.z, h: a.h });
      a.cargo = null; a.tx = 0; a.st = 'back';
      return;
    }
    case 'back': {
      if (headIn(col, a, dt)) chooseTask(col, a);
      return;
    }
  }
}
function pickCorpse(col, a, c) {
  col.corpses = col.corpses.filter(q => q !== c);
  a.cargo = { k: 'corpse' }; a.st = 'carry'; a.tx = 0;
}

// ------------------------------------------------------------------ queen
function queen(col, a, dt) {
  if (a.loc === 'surface') { headIn(col, a, dt); return; }
  const room = col.nest.room('royal');
  if (!room) return;
  const anchor = col.nest.roomAnchor(room);
  if (roomOf(col, a) !== room) { if (anchor >= 0) navTo(col, a, anchor, dt, 3); return; }
  if (a.spot >= 0) { if (strollTo(col, a, dt)) a.spot = -1; return; }
  if (col.rng.chance(0.05 * dt)) {
    const cells = roomOpenCells(col, room).filter(i => Math.abs(cx(i) - room.x) < room.rx * 0.45 && !col.nest.isOpen(i + COLS));
    if (cells.length) a.spot = col.rng.pick(cells);
  } else if (col.rng.chance(0.2 * dt)) a.h += col.rng.range(-0.4, 0.4);
}

function moveQueen(col, a, dt) {
  if (a.loc === 'surface') { headIn(col, a, dt); return; }
  const room = col.nest.room('royal');
  if (!room) { setTask(a, 'queen', 'stay'); return; }
  if (navTo(col, a, col.nest.roomAnchor(room), dt, 3)) setTask(a, 'queen', 'stay');
}

function found(col, a, dt) {
  switch (a.st) {
    case 'walk':
      if (goToward(col, a, ENTRANCE.x + 26, ENTRANCE.z + 30, dt)) { a.st = 'dewing'; a.t = 4; }
      return;
    case 'dewing':
      a.t -= dt; a.gait += dt * 3;
      if (a.t > 0) return;
      a.wings = false;
      col.surface.wings = { x: a.x, z: a.z, rot: a.h };
      col.say('女王が翅を落とし、巣づくりを始めました', 'nest');
      setTask(a, 'dig', 'pick');
      return;
  }
}

// ------------------------------------------------------------------ nuptial flight
function fly(col, a, dt) {
  const r = col.rng;
  switch (a.st) {
    case 'out': {
      if (!headOut(col, a, dt)) return;
      const ang = r.range(0.2, Math.PI - 0.2), dist = r.range(8, 34);
      a.tx = clamp(ENTRANCE.x + Math.cos(ang) * dist * 1.4, 10, W - 10);
      a.tz = clamp(ENTRANCE.z + Math.sin(ang) * dist, 4, SURF_D - 10);
      a.st = 'climb';
      return;
    }
    case 'climb':
      if (goToward(col, a, a.tx, a.tz, dt, 0.7)) { a.st = 'wing'; a.t = r.range(1.5, 14); }
      return;
    case 'wing':
      // Fanning the wings on the mound before take-off.
      a.t -= dt; a.flap = (a.flap || 0) + dt;
      if (r.chance(0.6 * dt)) a.h += r.range(-0.8, 0.8);
      if (a.t > 0) return;
      a.loc = 'air'; a.alt = col.surface.height(a.x, a.z); a.vx = r.range(-14, 14); a.vz = r.range(2, 10);
      a.st = 'up';
      return;
    case 'up':
      a.flap = (a.flap || 0) + dt;
      a.alt += (10 + a.alt * 0.25) * dt;
      a.x += a.vx * dt + Math.sin(col.time * 3 + a.id) * 6 * dt;
      a.z = clamp(a.z + a.vz * dt, 0, SURF_D);
      a.h = Math.atan2(a.vz, a.vx);
      if (a.alt > 320 || a.x < -20 || a.x > W + 20) a.gone = true;
      return;
  }
}

// Workers mill about the entrance while the winged ants leave.
function guard(col, a, dt) {
  const r = col.rng;
  switch (a.st) {
    case 'out':
      if (!headOut(col, a, dt)) return;
      a.st = 'watch'; a.t = r.range(40, 90);
      return;
    case 'watch': {
      a.t -= dt;
      const home = Math.hypot(a.x - ENTRANCE.x, a.z - ENTRANCE.z);
      let want = a.h + r.gauss() * 2.2 * Math.sqrt(dt);
      if (home > 34) want = Math.atan2(ENTRANCE.z - a.z, ENTRANCE.x - a.x);
      stepSurface(col, a, want, dt, speedOf(a, true) * 0.6);
      if (a.t <= 0) a.st = 'back';
      return;
    }
    case 'back':
      if (headIn(col, a, dt)) chooseTask(col, a);
      return;
  }
}
