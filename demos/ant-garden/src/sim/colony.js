// Colony: owns the world state and advances it in fixed steps.
import { ENTRANCE, DAY, STEP, MAX_ADULTS, FOODS, ROLE_NAMES, EGG_TIME, LARVA_TIME, PUPA_TIME, PX_PER_CM, YEAR_DAYS, YEAR_OFFSET, SEASON_NAMES } from './config.js';
import { Rng, clamp } from './rng.js';
import { generateSoil } from './soil.js';
import { Nest, cx, cy } from './nest.js';
import { Surface } from './surface.js';
import { makeAnt, updateAnt, chooseTask, dropCargo } from './ants.js';

export const SAVE_VERSION = 2;
const ROLE_CYCLE = ['food', 'brood', 'rest', 'brood', 'food', 'rest', 'brood'];
const STAGE_ORDER = { egg: 0, larva: 1, pupa: 2 };

// Egg-laying slows smoothly as the colony (adults + brood) approaches its cap,
// so births settle to balance deaths instead of stopping abruptly.
export function crowdFactor(count, max = MAX_ADULTS) {
  const fill = count / max;
  if (fill < 0.3) return 1;
  return Math.max(0.02, Math.pow(clamp((1 - fill) / 0.70), 1.6));
}

export class Colony {
  constructor({ seed = (Math.random() * 2 ** 31) | 0, mode = 'colony', name = 'わたしのアリの巣' } = {}) {
    this.seed = seed >>> 0;
    this.mode = mode;
    this.name = name;
    this.rng = new Rng(this.seed);
    this.soil = generateSoil(this.seed);
    this.nest = new Nest(this.soil);
    this.surface = new Surface(this.seed);
    this.time = 0;
    this.ants = []; this.brood = []; this.corpses = [];
    this.stores = { sugar: 0, protein: 0, seeds: 0 };
    this.nextAnt = 1; this.nextBrood = 1; this.nextCorpse = 1;
    this.events = []; this.history = []; this.fx = [];
    this.stats = { born: 0, died: 0, pellets: 0, sugar: 0, protein: 0, seeds: 0, peak: 0, eggs: 0 };
    this.milestones = {};
    this.needs = { dig: 0, forage: 0, nurse: 0, undertake: 0, brood: 0, digCap: 2, undertakeCap: 0 };
    this.counts = { dig: 0, forage: 0, nurse: 0, rest: 0, undertake: 0 };
    this.timers = { needs: 0, plan: 0, nature: 40, history: 0 };
    this.night = false; this.light = 1;
    this.cold = 0; this.warm = true; this.yearFrac = 0; this.temp = 0.5;
    this.nursery = null;
    this.extinct = false;
    this.broodVersion = 0;
  }

  // ---------------------------------------------------------------- setup
  static create(opts = {}) {
    const col = new Colony(opts);
    col.setup();
    return col;
  }

  setup() {
    const r = this.rng, nest = this.nest;
    const shaft = nest.newShaft({ x: ENTRANCE.x, y: -6 }, 0);
    if (this.mode === 'queen') {
      const seg = nest.planShaftSegment(shaft, r, 52, 10, 0.25);
      seg.founding = true;
      this.foundingPlan = { shaft: shaft.id, seg: seg.id };
      const q = makeAnt(this, { caste: 'queen', loc: 'surface', x: ENTRANCE.x - 190, z: 250, wings: true, reserve: 13, age: 0 });
      q.task = 'found'; q.st = 'walk'; q.h = -0.4;
      this.ants.push(q);
      this.say('一匹の女王アリが、この庭に舞い降りました', 'colony');
      this.stores = { sugar: 0, protein: 0, seeds: 0 };
    } else {
      const seg = nest.planShaftSegment(shaft, r, 72, 12, 0.25);
      nest.dig(seg);
      const at = nest.shaftXAt(shaft, 52);
      const room = nest.tryChamber(shaft, at.x, 52, r.sign(), 30, 10, r);
      nest.dig(room);
      room.role = 'royal';
      const anchor = nest.roomAnchor(room);
      const q = makeAnt(this, { caste: 'queen', x: cx(anchor), y: cy(anchor), age: DAY * 2 });
      q.h = 0;
      this.ants.push(q);
      for (let i = 0; i < 12; i++) {
        const a = makeAnt(this, { x: cx(anchor) + r.range(-18, 18), y: cy(anchor), age: 0 });
        a.age = a.life * r.range(0.05, 0.6);
        this.ants.push(a);
      }
      for (const [stage, n] of [['egg', 5], ['larva', 4], ['pupa', 3]]) {
        for (let i = 0; i < n; i++) this.addBrood(stage, room.id, r.range(0, 0.8));
      }
      this.stores = { sugar: 14, protein: 6, seeds: 0 };
      this.say('小さなコロニーの観察を始めました', 'colony');
    }
    for (let i = 0; i < 3; i++) this.spawnNatural(true);
    this.computeNeeds();
    for (const a of this.ants) if (a.caste !== 'queen') chooseTask(this, a);
    this.record();
  }

  addBrood(stage, room, p = 0) {
    const b = { id: this.nextBrood++, stage, p, food: stage === 'larva' ? 0.8 : 0, hunger: 0, room, carried: 0, slot: this.rng.next() };
    this.brood.push(b);
    this.broodVersion++;
    return b;
  }

  // ---------------------------------------------------------------- queries
  get queen() { return this.ants.find(a => a.caste === 'queen'); }
  get workers() { return this.ants.filter(a => a.caste === 'worker'); }
  get day() { return Math.floor(this.time / DAY) + 1; }
  get timeOfDay() { return (this.time / DAY + 0.3) % 1; }
  get year() { return Math.floor((this.time / DAY + YEAR_OFFSET) / YEAR_DAYS) + 1; }
  get season() { return Math.floor(this.yearFrac * 4) % 4; }
  get seasonName() { return SEASON_NAMES[this.season]; }
  get alates() { return this.ants.filter(a => a.caste === 'gyne' || a.caste === 'male'); }

  // Seasons: temperature peaks in mid-summer and bottoms out in mid-winter.
  updateSeason() {
    this.yearFrac = ((this.time / DAY + YEAR_OFFSET) / YEAR_DAYS) % 1;
    this.temp = 0.5 + 0.5 * Math.cos(2 * Math.PI * (this.yearFrac - 0.35));
    this.cold = clamp((0.3 - this.temp) / 0.3);
    const tod = this.timeOfDay;
    this.warm = tod > 0.32 && tod < 0.78 && this.cold < 0.35;
  }

  say(text, kind = 'info') {
    this.events.unshift({ t: this.time, text, kind });
    if (this.events.length > 300) this.events.length = 300;
  }

  foodRoom() {
    const rooms = this.nest.rooms('food').filter(f => f.done);
    if (rooms.length) return rooms.reduce((a, b) => (a.y < b.y ? a : b));
    return this.nest.room('royal');
  }

  restRoom(a) {
    const rooms = this.nest.chambers.filter(f => f.started && f.done && f.role !== 'royal');
    const pool = rooms.length ? rooms : this.nest.chambers.filter(f => f.started);
    if (!pool.length) return null;
    if (this.cold > 0.4) {
      const deep = [...pool].sort((p, q) => q.y - p.y);
      return this.rng.pick(deep.slice(0, Math.max(1, Math.ceil(deep.length / 3))));
    }
    const pref = pool.filter(f => f.role === 'rest');
    return this.rng.chance(0.6) && pref.length ? this.rng.pick(pref) : this.rng.pick(pool);
  }

  broodRooms() {
    return this.nest.chambers.filter(f => f.started && (f.role === 'royal' || f.role === 'brood'));
  }

  broodIn(roomId) { return this.brood.filter(b => b.room === roomId && !b.carried); }

  hungriest(roomId) {
    let best = null;
    for (const b of this.brood) {
      if (b.room !== roomId || b.carried || b.stage !== 'larva') continue;
      if (!best || b.food < best.food) best = b;
    }
    return best && best.food < 0.7 ? best : null;
  }

  // Decide what a nurse should do: feed a hungry larva or relocate brood.
  broodJob(a) {
    const rooms = this.broodRooms();
    if (!rooms.length || !this.brood.length) return null;
    const royal = this.nest.room('royal');
    const nursery = rooms.filter(f => f.role === 'brood' && f.done);
    // Brood lying in a room that is not a nursery gets carried to one.
    const stray = this.brood.find(b => !b.carried && !rooms.some(f => f.id === b.room));
    if (stray && (nursery[0] || royal)) {
      return { fetch: stray.id, from: stray.room, to: (nursery[0] || royal).id };
    }
    // Day/night (and winter) relocation: larvae and pupae go where the soil is comfortable.
    const plan = this.nursery;
    if (plan && this.rng.chance(0.85)) {
      const taken = new Set(this.ants.filter(q => q.task === 'nurse' && q.st === 'fetch').map(q => q.tx));
      const loose = this.brood.filter(b => !b.carried && b.stage !== 'egg' && !plan.set.has(b.room) && !taken.has(b.id));
      if (loose.length) {
        const dest = plan.order.find(f => this.broodIn(f.id).length < plan.cap.get(f.id)) || plan.order[0];
        const b = this.rng.pick(loose);
        return { fetch: b.id, from: b.room, to: dest.id };
      }
    }
    if (royal && nursery.length && this.rng.chance(0.5)) {
      const crowd = this.broodIn(royal.id).filter(b => b.stage !== 'egg');
      if (crowd.length > 6) {
        const dest = nursery.reduce((m, f) => (this.broodIn(f.id).length < this.broodIn(m.id).length ? f : m));
        const b = this.rng.pick(crowd);
        return { fetch: b.id, from: royal.id, to: dest.id };
      }
    }
    let best = null, bestScore = 0;
    for (const f of rooms) {
      let hungry = 0;
      for (const b of this.brood) if (b.room === f.id && !b.carried && b.stage === 'larva' && b.food < 0.7) hungry++;
      const score = hungry + this.rng.next() * 0.5;
      if (hungry && score > bestScore) { bestScore = score; best = f; }
    }
    return best ? { room: best.id } : null;
  }

  // Which nursery rooms larvae and pupae should lie in right now: the shallowest
  // (warm) rooms by day, the deepest (stable, cool) rooms at night and in winter.
  planNursery() {
    const rooms = this.nest.chambers.filter(f => f.done && f.role === 'brood');
    if (rooms.length < 1) { this.nursery = null; return 0; }
    const order = [...rooms].sort((p, q) => (this.warm ? p.y - q.y : q.y - p.y));
    let need = 0;
    for (const b of this.brood) if (b.stage !== 'egg') need++;
    const set = new Set(), cap = new Map();
    let room = 0;
    for (const f of order) {
      const span = this.nest.roomSpan(f);
      const c = Math.max(10, Math.floor((span.x1 - span.x0) / 5.5) * 2);
      cap.set(f.id, c); set.add(f.id); room += c;
      if (room >= need * 1.15) break;
    }
    this.nursery = { set, cap, order: order.filter(f => set.has(f.id)) };
    let misplaced = 0;
    for (const b of this.brood) if (b.stage !== 'egg' && !b.carried && !set.has(b.room)) misplaced++;
    const quiet = this.time - (this.milestones.broodMove ?? -1e9) < DAY * 3;
    if (this.lastWarm !== undefined && this.lastWarm !== this.warm && misplaced >= 3 && rooms.length >= 2 && !quiet) {
      this.milestones.broodMove = this.time;
      this.say(this.warm ? '朝になり、子どもたちを暖かい浅い部屋へ運び始めました' : this.cold > 0.35 ? '寒くなり、子どもたちを深い部屋へ移しています' : '日が暮れ、子どもたちを深い部屋へ運び始めました', 'nest');
    }
    this.lastWarm = this.warm;
    return misplaced;
  }

  // A nurse gives one meal to the hungriest larva in a room.
  feedLarva(roomId) {
    const b = this.hungriest(roomId);
    if (!b) return false;
    const s = this.stores;
    if (s.protein >= 0.3) { s.protein -= 0.3; b.food += 1; }
    else if (s.seeds >= 0.45) { s.seeds -= 0.45; b.food += 1; }
    else if (s.sugar >= 0.6) { s.sugar -= 0.6; b.food += 0.4; }
    else return false;
    b.hunger = 0;
    return true;
  }

  recruit(a, food) {
    const n = food.amount > 25 ? 2 : 1;
    if (this.counts.forage > 6 + this.workers.length * 0.45) return;
    const pool = this.ants.filter(b => b.caste === 'worker' && b.loc === 'nest' && b.callow <= 0 && b !== a &&
      ((b.task === 'rest' && b.st === 'idle') || (b.task === 'nurse' && b.age / b.life > 0.3)) && !b.cargo);
    pool.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
    for (const b of pool.slice(0, n)) {
      b.task = 'forage'; b.st = 'out'; b.t = 0; b.n = 0; b.search = 0; b.mem = null; b.dest = -1;
      b.rec = { x: food.x + this.rng.gauss() * 18, z: food.z + this.rng.gauss() * 12 };
      this.counts.forage++;
    }
  }

  // ---------------------------------------------------------------- food
  placeFood(type, x, z) {
    if (!FOODS[type] || FOODS[type].natural || this.extinct) return null;
    if (!this.surface.canPlace(x, z)) return null;
    if (this.surface.foods.filter(f => f.user).length >= 24) return null;
    const f = this.surface.addFood(type, x, z, this.rng, true);
    const dist = Math.hypot(x - ENTRANCE.x, z - ENTRANCE.z) / PX_PER_CM;
    this.say(`${FOODS[type].name}を置きました（入口から${dist.toFixed(1)}cm）`, 'user');
    return f;
  }

  removeFood(id) {
    this.surface.foods = this.surface.foods.filter(f => f.id !== id);
  }

  foodGone(f) {
    this.removeFood(f.id);
    if (f.user) this.say(`${FOODS[f.type].name}がすべて巣へ運ばれました`, 'food');
    for (const a of this.ants) if (a.mem && a.mem.id === f.id) a.mem.gone = true;
  }

  spawnNatural(initial = false) {
    const naturals = this.surface.foods.filter(f => !f.user).length;
    if (naturals >= 5) return;
    const r = this.rng;
    const type = r.pick(['bug', 'bug', 'nectar', 'nectar', 'grass']);
    for (let k = 0; k < 20; k++) {
      const ang = r.range(0, Math.PI), dist = r.range(initial ? 120 : 90, 520);
      const x = ENTRANCE.x + Math.cos(ang) * dist * 1.4, z = ENTRANCE.z + Math.sin(ang) * dist * 0.6;
      if (!this.surface.canPlace(x, z) || z < 30) continue;
      this.surface.addFood(type, x, z, r, false);
      return;
    }
  }

  // ---------------------------------------------------------------- per-second bookkeeping
  computeNeeds() {
    const workers = this.workers, nest = this.nest;
    const counts = { dig: 0, forage: 0, nurse: 0, rest: 0, undertake: 0 };
    for (const a of workers) counts[a.task] = (counts[a.task] || 0) + 1;
    this.counts = counts;
    const n = workers.length;
    let larvae = 0, hungry = 0;
    for (const b of this.brood) if (b.stage === 'larva') { larvae++; if (b.food < 0.5) hungry++; }
    const need = this.areaNeed();
    const deficit = (need - nest.area) / need;
    let frontier = 0;
    for (const f of nest.features) if (!f.done) frontier += nest.frontier(f).length;
    const misplaced = this.planNursery();
    const s = this.stores;
    const sugarNeed = clamp(1 - s.sugar / (n * 0.9 + 8));
    const protNeed = clamp(1 - (s.protein + s.seeds * 0.65) / (larvae * 1.4 + 5));
    const knownFood = this.surface.foods.some(f => f.found && f.amount > 0);
    this.needs = {
      dig: frontier ? clamp(deficit * 2.6 + 0.3, 0.25, 1) * (1 - 0.8 * this.cold) : 0,
      digCap: Math.max(2, Math.min(36, Math.ceil(frontier * 0.7))),
      forage: clamp(Math.max(sugarNeed, protNeed * 1.1) * 0.8 + 0.12 + (knownFood ? 0.12 : 0)) * (this.night ? 0.35 : 1) * (1 - this.cold),
      hunger: Math.max(sugarNeed, protNeed),
      nurse: this.brood.length ? clamp(0.25 + (hungry / (counts.nurse * 2 + 1)) * 0.75 + (misplaced / (counts.nurse * 2 + 1)) * 0.6) : 0,
      undertake: this.corpses.length ? 0.9 : 0,
      undertakeCap: this.corpses.length,
      brood: this.brood.length,
    };
  }

  areaNeed() {
    const s = this.stores;
    return 1300 + 165 * this.ants.length + 40 * this.brood.length + 10 * (s.protein + s.seeds);
  }

  plan() {
    const workers = this.workers.length;
    const nest = this.nest;
    if (this.mode === 'queen' && !workers) return; // the founding queen only digs her own cell
    const need = this.areaNeed() - nest.area;
    const maxActive = Math.min(4, 1 + Math.floor(workers / 18));
    const f = nest.plan(this.rng, need, maxActive);
    if (!f && need > 0) this.timers.plan = 5; // back off while nothing fits
    if (f && f.kind === 'chamber') {
      const depth = (f.y / PX_PER_CM).toFixed(1);
      this.say(`新しい部屋を掘り始めました（深さ${depth}cm）`, 'nest');
    }
  }

  settleNest(dt) {
    // Drop claims held by ants that are no longer working that cell.
    const holders = new Map(this.ants.filter(a => a.site).map(a => [a.id, a.site.cell]));
    for (const [cell, id] of this.nest.claims) if (holders.get(id) !== cell) this.nest.claims.delete(cell);
    const done = this.nest.settle(dt);
    for (const f of done) {
      if (f.kind === 'chamber' && f.role === 'dig' && !f.founding) {
        f.role = ROLE_CYCLE[this.nest.roleCycle++ % ROLE_CYCLE.length];
        this.say(`部屋が完成しました：${ROLE_NAMES[f.role]}（深さ${(f.y / PX_PER_CM).toFixed(1)}cm）`, 'nest');
        this.maybeRelocate(f);
      }
      if (f.founding) this.foundingProgress(f);
    }
    const depth = Math.floor(this.nest.depth / PX_PER_CM / 5) * 5;
    if (depth >= 5 && !this.milestones['depth' + depth]) {
      this.milestones['depth' + depth] = true;
      this.say(`巣の深さが${depth}cmに達しました`, 'nest');
    }
  }

  foundingProgress(f) {
    const nest = this.nest, r = this.rng;
    if (f.kind === 'tunnel') {
      const shaft = nest.shafts[0];
      const at = nest.shaftXAt(shaft, 38);
      const room = at && nest.tryChamber(shaft, at.x, 38, r.sign(), 15, 7, r);
      if (room) { room.founding = true; room.role = 'dig'; }
      else this.claimRoyal(nest.features.find(g => g.id === f.id));
    } else if (f.kind === 'chamber') {
      this.claimRoyal(f);
    }
  }

  claimRoyal(f) {
    f.role = 'royal'; f.kind = 'chamber'; f.started = true;
    if (f.x === undefined) { f.x = (f.from.x + f.to.x) / 2; f.y = (f.from.y + f.to.y) / 2; f.rx = 6; f.ry = 10; }
    const q = this.queen;
    if (q) { q.task = 'move'; q.st = 'go'; q.site = null; q.cargo = null; }
    this.say('女王が小さな部屋にこもり、卵を産み始めます', 'colony');
  }

  maybeRelocate(f) {
    const royal = this.nest.room('royal');
    const q = this.queen;
    if (!royal || !q || royal === f) return;
    if (f.y > royal.y + 110 && this.workers.length >= 25) {
      royal.role = 'brood'; f.role = 'royal';
      q.task = 'move'; q.st = 'go';
      this.say('女王が、より深い部屋へ引っ越しを始めました', 'colony');
    }
  }

  // ---------------------------------------------------------------- brood & queen
  updateBrood(dt) {
    const workers = this.workers.length;
    const q = this.queen;
    const founding = !workers && q;
    const pace = dt * (1 - 0.9 * this.cold);
    for (const b of this.brood) {
      const slow = b.caste ? 1.35 : 1;
      if (b.stage === 'egg') {
        b.p += pace / EGG_TIME;
        if (b.p >= 1) { b.stage = 'larva'; b.p = 0; b.food = 0.6; this.broodVersion++; }
      } else if (b.stage === 'larva') {
        if (founding && b.food < 0.5 && q.reserve >= 0.35) { q.reserve -= 0.35; b.food += 1; }
        if (b.food > 0) {
          b.p += pace / (LARVA_TIME * slow);
          b.food -= pace * 2.3 / LARVA_TIME;
          b.hunger = 0;
        } else b.hunger += pace;
        if (b.hunger > 280) {
          b.dead = true;
          if (!(this.time - (this.milestones.larvaLost ?? -1e9) < 180)) { this.milestones.larvaLost = this.time; this.say('タンパク質が足りず、幼虫が育ちきれませんでした', 'warn'); }
        }
        if (b.p >= 1) { b.stage = 'pupa'; b.p = 0; b.food = 0; this.broodVersion++; }
      } else if (b.stage === 'pupa') {
        b.p += pace / (PUPA_TIME * slow);
        if (b.p >= 1) { b.dead = true; this.eclose(b); }
      }
    }
    if (this.brood.some(b => b.dead)) {
      for (const b of this.brood) if (b.dead && b.carried) {
        const a = this.ants.find(x => x.id === b.carried);
        if (a) a.cargo = null;
      }
      this.brood = this.brood.filter(b => !b.dead);
      this.broodVersion++;
    }
    if (q && q.task !== 'found' && !(q.task === 'dig')) this.lay(q, dt);
  }

  lay(q, dt) {
    q.lay -= dt;
    if (q.lay > 0) return;
    const workers = this.workers.length;
    const royal = this.nest.room('royal');
    const crowd = crowdFactor(this.ants.length + this.brood.length);
    q.lay = (workers ? clamp(22 - workers * 0.14, 4, 22) : 20) * this.rng.range(0.7, 1.3) / crowd / Math.max(0.05, 1 - this.cold);
    if (crowd < 0.6 && !this.milestones.crowded) {
      this.milestones.crowded = true;
      this.say('巣がにぎやかになり、女王の産卵がゆっくりになってきました', 'colony');
    }
    if (!royal || q.task !== 'queen' || this.cold > 0.75) return;
    const cap = workers ? 10 + workers * 0.75 : 8;
    if (this.brood.length >= cap || this.ants.length + this.brood.length >= MAX_ADULTS) return;
    if (!workers && this.stats.eggs >= 9) return;
    const s = this.stores;
    if (!workers) { if (q.reserve < 0.4) return; q.reserve -= 0.4; }
    else if (s.protein >= 0.25) s.protein -= 0.25;
    else if (s.seeds >= 0.4) s.seeds -= 0.4;
    else if (s.sugar >= 0.8 && this.rng.chance(0.08)) s.sugar -= 0.8;
    else return;
    const egg = this.addBrood('egg', royal.id);
    this.stats.eggs++;
    // Well-fed, large colonies raise winged queens and males in early summer.
    const repro = this.repro || (this.repro = { year: 0, made: 0 });
    if (repro.year !== this.year) { repro.year = this.year; repro.made = 0; }
    const quota = Math.min(24, Math.floor(workers / 8));
    if (this.yearFrac > 0.18 && this.yearFrac < 0.42 && workers >= 60 && repro.made < quota && s.protein + s.seeds > 15 && this.rng.chance(0.35)) {
      egg.caste = this.rng.chance(0.4) ? 'gyne' : 'male';
      repro.made++;
      if (repro.made === 1) this.say('次の世代の女王とオスになる卵が産まれはじめました', 'colony');
    }
    if (this.stats.eggs === 1) this.say('最初の卵が産まれました', 'colony');
  }

  eclose(b) {
    const room = this.nest.feature(b.room);
    const anchor = room ? this.nest.roomAnchor(room) : -1;
    const p = this.broodPos(b) || (anchor >= 0 ? { x: cx(anchor), y: cy(anchor) } : null);
    if (!p) return;
    if (b.caste) {
      const a = makeAnt(this, { caste: b.caste, x: p.x, y: p.y - 2, callow: 60, age: 0 });
      this.ants.push(a);
      chooseTask(this, a);
      if (!this.milestones['alate' + this.year]) { this.milestones['alate' + this.year] = true; this.say('翅のある新しい女王とオスが羽化しました', 'colony'); }
      return;
    }
    const a = makeAnt(this, { x: p.x, y: p.y - 2, callow: 90, age: 0 });
    a.energy = 0.8;
    this.ants.push(a);
    chooseTask(this, a);
    this.stats.born++;
    const n = this.workers.length;
    if (this.stats.born === 1) this.say('最初の働きアリが羽化しました！', 'colony');
    for (const m of [10, 25, 50, 100, 150, 200, 300, 400]) {
      if (n >= m && !this.milestones['pop' + m]) { this.milestones['pop' + m] = true; this.say(`働きアリが${m}匹になりました`, 'colony'); }
    }
  }

  // Positions of brood piled on a room floor: eggs in the middle, then larvae, pupae outside.
  layoutRoom(room) {
    const key = this.broodVersion + ':' + this.nest.version;
    if (room._layoutKey === key) return room._layout;
    const items = this.broodIn(room.id).sort((p, q) => STAGE_ORDER[p.stage] - STAGE_ORDER[q.stage] || p.id - q.id);
    const span = this.nest.roomSpan(room);
    const mid = (span.x0 + span.x1) / 2, half = Math.max(6, (span.x1 - span.x0) / 2 - 7);
    const out = new Map();
    let row = 0, left = 0, right = 0, side = 1;
    for (const b of items) {
      const w = (b.stage === 'egg' ? 3.4 : b.stage === 'larva' ? 5.2 : 6.4) * (b.caste === 'gyne' && b.stage !== 'egg' ? 1.4 : 1);
      let x;
      if (side > 0) { x = mid + right + w / 2; right += w * 0.92; } else { x = mid - left - w / 2; left += w * 0.92; }
      side = -side;
      if (Math.max(left, right) > half) { row++; left = right = row * 1.8; }
      const floor = this.nest.floorY(x, room);
      out.set(b.id, { x, y: floor - 1.8 - row * 3.6 - (b.stage === 'egg' ? 0 : 0.6) });
    }
    room._layout = out; room._layoutKey = key;
    return out;
  }

  broodPos(b) {
    const room = this.nest.feature(b.room);
    if (!room) return null;
    return this.layoutRoom(room).get(b.id) || null;
  }

  // ---------------------------------------------------------------- main step
  step(dt = STEP) {
    if (this.extinct) return;
    this.time += dt;
    const tod = this.timeOfDay;
    this.light = clamp(0.5 - 0.5 * Math.cos((tod - 0.02) * Math.PI * 2) * 1.25 + 0.12, 0, 1);
    this.night = tod > 0.82 || tod < 0.2;
    this.updateSeason();
    this.surface.evaporate(dt);

    const t = this.timers;
    t.needs -= dt;
    if (t.needs <= 0) { t.needs = 1; this.computeNeeds(); this.settleNest(1); this.seasonEvents(); }
    t.plan -= dt;
    if (t.plan <= 0) { t.plan = 1.5; this.plan(); }
    t.nature -= dt;
    if (t.nature <= 0) {
      t.nature = this.rng.range(55, 110) / Math.max(0.3, this.temp * 1.4);
      if (this.cold < 0.4) this.spawnNatural();
    }

    for (const a of this.ants) updateAnt(this, a, dt);
    this.updateBrood(dt);

    if (this.ants.some(a => a.dead)) this.bury();
    if (this.ants.some(a => a.gone)) {
      this.stats.flown = (this.stats.flown || 0) + this.ants.filter(a => a.gone).length;
      this.ants = this.ants.filter(a => !a.gone);
    }
    t.history -= dt;
    if (t.history <= 0) { t.history = 20; this.record(); }
    if (this.fx.length > 4000) this.fx.splice(0, this.fx.length - 2000);
  }

  seasonEvents() {
    const season = this.season;
    if (this.lastSeason !== undefined && this.lastSeason !== season) {
      const text = ['春になりました。アリたちの動きが活発になります', '夏になりました', '秋になりました', '冬になりました。アリたちは深い部屋に集まって冬を越します'][season];
      this.say(text, 'season');
    }
    this.lastSeason = season;
    // Nuptial flight: on a warm, bright late-summer day all winged ants leave together.
    const key = 'flight' + this.year;
    const tod = this.timeOfDay;
    if (!this.milestones[key] && this.yearFrac > 0.44 && this.yearFrac < 0.7 && tod > 0.42 && tod < 0.6 && this.cold < 0.1) {
      const alates = this.alates.filter(a => a.callow <= 0);
      if (alates.length >= 3) {
        this.milestones[key] = true;
        for (const a of alates) { chooseTask(this, a); a.task = 'fly'; a.st = 'out'; }
        const helpers = this.workers.filter(a => a.task === 'rest' && a.callow <= 0);
        for (const a of helpers.slice(0, 6 + Math.floor(helpers.length * 0.3))) { chooseTask(this, a); a.task = 'guard'; a.st = 'out'; }
        const g = alates.filter(a => a.caste === 'gyne').length;
        this.say(`結婚飛行！ 新しい女王${g}匹とオス${alates.length - g}匹が飛び立ちます`, 'colony');
      }
    }
  }

  bury() {
    for (const a of this.ants) {
      if (!a.dead) continue;
      dropCargo(this, a);
      if (a.site) this.nest.release(a.site.cell);
      this.stats.died++;
      for (const c of this.corpses) if (c.claimed === a.id) c.claimed = 0;
      if (a.caste === 'queen') {
        this.say(a.dead === 'starved' ? '女王が飢えで亡くなりました…' : '女王が寿命を迎えました', 'warn');
      } else if (a.dead === 'starved') {
        if (!this.milestones.starve || this.time - this.milestones.starve > 120) {
          this.milestones.starve = this.time;
          this.say('食料が尽き、働きアリが飢えています', 'warn');
        }
      }
      this.corpses.push({ id: this.nextCorpse++, loc: a.loc, x: a.x, y: a.y, z: a.z, h: a.h, claimed: 0, queen: a.caste === 'queen' });
    }
    this.ants = this.ants.filter(a => !a.dead);
    if (!this.ants.length) { this.extinct = true; this.say('コロニーは静かに幕を閉じました', 'warn'); }
  }

  record() {
    const w = this.workers.length;
    this.stats.peak = Math.max(this.stats.peak, w);
    this.history.push({ t: Math.round(this.time), w, b: this.brood.length, a: Math.round(this.nest.area / 100), f: Math.round(this.stores.sugar + this.stores.protein + this.stores.seeds) });
    if (this.history.length > 720) this.history = this.history.filter((_, i) => i % 2 === 0);
  }

  // ---------------------------------------------------------------- persistence
  serialize() {
    return {
      v: SAVE_VERSION, seed: this.seed, mode: this.mode, name: this.name, rng: this.rng.s, time: this.time,
      nest: this.nest.serialize(), surface: this.surface.serialize(),
      ants: this.ants, brood: this.brood, corpses: this.corpses, stores: this.stores,
      nextAnt: this.nextAnt, nextBrood: this.nextBrood, nextCorpse: this.nextCorpse,
      events: this.events, history: this.history, stats: this.stats, milestones: this.milestones,
      repro: this.repro || null, lastSeason: this.lastSeason ?? null, lastWarm: this.lastWarm ?? null,
      timers: this.timers, foundingPlan: this.foundingPlan || null, extinct: this.extinct,
    };
  }

  static restore(d) {
    if (!d || d.v !== SAVE_VERSION) throw new Error('unsupported save');
    const col = new Colony({ seed: d.seed, mode: d.mode, name: d.name });
    col.rng.s = d.rng; col.time = d.time;
    col.nest.restore(d.nest);
    col.surface.restore(d.surface);
    col.ants = d.ants.map(a => ({ ...a, life: a.life ?? Infinity }));
    for (const a of col.ants) if (a.caste === 'queen') a.life = Infinity;
    col.brood = d.brood; col.corpses = d.corpses; col.stores = d.stores;
    col.nextAnt = d.nextAnt; col.nextBrood = d.nextBrood; col.nextCorpse = d.nextCorpse;
    col.events = d.events; col.history = d.history; col.stats = d.stats; col.milestones = d.milestones;
    col.repro = d.repro || null;
    if (d.lastSeason !== null && d.lastSeason !== undefined) col.lastSeason = d.lastSeason;
    if (d.lastWarm !== null && d.lastWarm !== undefined) col.lastWarm = d.lastWarm;
    col.timers = d.timers; col.foundingPlan = d.foundingPlan; col.extinct = d.extinct;
    for (const a of col.ants) if (a.site && a.task === 'dig' && (a.st === 'go' || a.st === 'dig')) col.nest.claims.set(a.site.cell, a.id);
    col.updateSeason();
    col.computeNeeds();
    return col;
  }
}

