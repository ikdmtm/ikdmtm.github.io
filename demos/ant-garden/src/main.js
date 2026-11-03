import { Colony } from './sim/colony.js';
import { STEP, DAY, FOODS, PX_PER_CM, ROLE_NAMES, TASK_NAMES, STATE_NAMES, USER_FOODS } from './sim/config.js';
import { Renderer } from './render/renderer.js';

const SAVE_KEY = 'ant-garden.v2';
const $ = id => document.getElementById(id);
const canvas = $('view');
const renderer = new Renderer(canvas);

const app = {
  col: null, speed: 1, paused: false, tool: 'look',
  lastEvent: 0, uiTimer: 0, saveTimer: 0, budgetWarn: 0,
};
window.antGarden = app; // handy for debugging and tests
window.__renderer = renderer;

// ------------------------------------------------------------------ save / load
function save() {
  if (!app.col) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ colony: app.col.serialize(), speed: app.speed, savedAt: Date.now() })); }
  catch (err) { console.warn('save failed', err); }
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    app.speed = [1, 3, 10, 30].includes(data.speed) ? data.speed : 1;
    return Colony.restore(data.colony);
  } catch (err) {
    console.warn('load failed', err);
    return null;
  }
}

function start(col) {
  app.col = col;
  renderer.attach(col);
  renderer.resize();
  renderer.fit();
  app.lastEvent = col.events.length ? col.events[0].t : -1;
  renderer.selected = null;
  $('colonyName').textContent = col.name;
  updateUI(true);
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const col = app.col;
  if (col && !app.paused && !document.hidden) {
    col.acc = (col.acc || 0) + dt * app.speed;
    const t0 = performance.now();
    while (col.acc >= STEP) {
      col.step(STEP);
      col.acc -= STEP;
      if (performance.now() - t0 > 14) { col.acc = 0; break; } // drop time rather than freeze
    }
  }
  renderer.draw(dt);
  app.uiTimer -= dt;
  if (app.uiTimer <= 0) { app.uiTimer = 0.25; updateUI(); }
  app.saveTimer += dt;
  if (app.saveTimer > 15) { app.saveTimer = 0; save(); }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ HUD
const fmtTime = col => {
  const m = Math.floor(col.timeOfDay * 24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const fmtStamp = t => {
  const day = Math.floor(t / DAY) + 1, m = Math.floor((((t / DAY) + 0.3) % 1) * 24 * 60);
  return `${day}日目 ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function updateUI(force = false) {
  const col = app.col;
  if (!col) return;
  $('dayText').textContent = `${col.year > 1 ? `${col.year}年目 ` : ''}${col.seasonName} · ${col.day}日目`;
  $('timeText').textContent = fmtTime(col);
  $('clockIcon').innerHTML = `<use href="#i-${col.night ? 'moon' : 'sun'}"/>`;
  const workers = col.workers.length;
  let e = 0, l = 0, p = 0;
  for (const b of col.brood) { if (b.stage === 'egg') e++; else if (b.stage === 'larva') l++; else p++; }
  $('sWorkers').innerHTML = `${workers}<small>匹</small>`;
  $('sBrood').innerHTML = `${e}<small>・</small>${l}<small>・</small>${p}`;
  const s = col.stores;
  const low = s.sugar < workers * 0.3 + 1;
  $('sFood').innerHTML = `<span class="${low ? 'warn' : ''}">蜜 ${Math.floor(s.sugar)}</span><small> 肉 ${Math.floor(s.protein)} 種 ${Math.floor(s.seeds)}</small>`;
  $('sDepth').innerHTML = `${(col.nest.depth / PX_PER_CM).toFixed(1)}<small>cm</small>`;

  // New events -> toasts
  const fresh = col.events.filter(ev => ev.t > app.lastEvent && ev.kind !== 'user');
  if (col.events.length) app.lastEvent = Math.max(app.lastEvent, col.events[0].t);
  for (const ev of fresh.slice(0, 3).reverse()) toast(ev.text, ev.kind);

  if (!$('notebook').hidden) updateNotebook(force);
  updateExtinct();
}

function toast(text, kind) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => el.classList.add('out'), 5200);
  setTimeout(() => el.remove(), 6000);
}

// ------------------------------------------------------------------ notebook
let activeTab = 'colony';
function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.dataset.panel !== tab; });
  updateNotebook(true);
}
function openNotebook(open, tab) {
  $('notebook').hidden = !open;
  $('notebookBtn').setAttribute('aria-expanded', String(open));
  if (open) setTab(tab || activeTab);
}

function updateNotebook(force) {
  const col = app.col;
  if (activeTab === 'colony') {
    drawChart();
    const counts = { forage: 0, dig: 0, nurse: 0, rest: 0, undertake: 0 };
    for (const a of col.workers) counts[a.task] = (counts[a.task] || 0) + 1;
    const names = { forage: '餌さがし', dig: '巣を掘る', nurse: '子育て', rest: '休憩', undertake: '弔い' };
    const total = Math.max(1, col.workers.length);
    $('taskBars').innerHTML = Object.keys(names).map(k => `
      <div class="bar-row"><span class="name">${names[k]}</span><span class="track"><span class="fill" style="width:${(counts[k] / total * 100).toFixed(1)}%"></span></span><span class="num">${counts[k]}</span></div>`).join('');
    const s = col.stores;
    $('storeList').innerHTML = kv([
      ['蜜（糖分）', s.sugar.toFixed(1)], ['虫の肉（タンパク質）', s.protein.toFixed(1)], ['種', s.seeds.toFixed(1)],
      ['これまでに運んだ餌', `${col.stats.sugar + col.stats.protein + col.stats.seeds}回`],
    ]);
    const rooms = col.nest.chambers.filter(f => f.started);
    const roles = {};
    for (const r of rooms) roles[r.role] = (roles[r.role] || 0) + 1;
    $('nestList').innerHTML = kv([
      ['部屋', `${rooms.length}室`],
      ...Object.entries(roles).map(([k, v]) => [`　${ROLE_NAMES[k]}`, `${v}`]),
      ['深さ', `${(col.nest.depth / PX_PER_CM).toFixed(1)}cm`],
      ['掘り出した土', `${col.stats.pellets}粒`],
      ['生まれた働きアリ', `${col.stats.born}匹`],
      ...(col.alates.length ? [['飛び立ちを待つ羽アリ', `${col.alates.length}匹`]] : []),
      ...(col.stats.flown ? [['巣立った羽アリ', `${col.stats.flown}匹`]] : []),
      ['亡くなった仲間', `${col.stats.died}匹`],
    ]);
  } else if (activeTab === 'ant') {
    updateAntCard();
  } else if (activeTab === 'journal') {
    const key = col.events.length + ':' + (col.events[0]?.t ?? 0);
    if (!force && key === updateNotebook.jkey) return;
    updateNotebook.jkey = key;
    $('journal').innerHTML = col.events.map(ev => `<li class="${ev.kind}"><time>${fmtStamp(ev.t)}</time><span>${escapeHtml(ev.text)}</span></li>`).join('');
  }
}
const kv = rows => rows.map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function updateAntCard() {
  const col = app.col;
  const a = col.ants.find(q => q.id === renderer.selected);
  const card = $('antCard');
  if (!a) {
    card.innerHTML = '<p class="muted">地上や巣の中のアリをクリックすると、その子の様子が見られます。</p>';
    return;
  }
  const queen = a.caste === 'queen';
  const alate = a.caste === 'gyne' || a.caste === 'male';
  const doing = STATE_NAMES[`${a.task}:${a.st}`] || TASK_NAMES[a.task] || '';
  const ageDays = (a.age / DAY).toFixed(1);
  const where = a.loc === 'air' ? '空' : a.loc === 'surface' ? '地上' : (() => {
    const d = (a.y / PX_PER_CM).toFixed(1);
    return `地下 ${d}cm`;
  })();
  const following = renderer.target === a.id;
  card.innerHTML = `
    <h4>${queen ? '女王アリ' : a.caste === 'gyne' ? `新女王（羽アリ） No.${a.id}` : a.caste === 'male' ? `オス（羽アリ） No.${a.id}` : `働きアリ No.${a.id}`}</h4>
    <p class="sub">${queen ? 'コロニーの母' : alate ? '結婚飛行で巣立つ、次の世代' : `${ageDays}日齢${a.callow > 0 ? '（羽化したばかり）' : ''}`} · ${where}</p>
    <div class="doing">${escapeHtml(doing)}</div>
    <div class="kv"><span class="k">元気</span><span class="v">${Math.round(Math.max(0, a.energy) * 100)}%</span></div>
    <div class="meter"><i style="width:${Math.max(0, Math.min(1, a.energy)) * 100}%"></i></div>
    <div class="kv">
      ${queen ? `<span class="k">産んだ卵</span><span class="v">${col.stats.eggs}個</span>` : alate ? `<span class="k">日齢</span><span class="v">${ageDays}日</span>` : `
      <span class="k">運んだ餌</span><span class="v">${a.done.food}回</span>
      <span class="k">掘り出した土</span><span class="v">${a.done.soil}粒</span>
      <span class="k">子どもの世話</span><span class="v">${a.done.care}回</span>`}
    </div>
    <div class="modal-actions" style="justify-content:flex-start">
      <button class="btn ghost" id="followBtn" aria-pressed="${following}"><svg class="ico sm"><use href="#i-follow"/></svg>${following ? '追いかけています' : 'この子を追いかける'}</button>
    </div>`;
  $('followBtn').onclick = () => {
    if (renderer.target === a.id) renderer.follow(null);
    else { renderer.follow(a); if (renderer.cam.zoom < 2.2) renderer.cam.zoom = 2.6; }
    updateAntCard();
  };
}

// Single-series population chart with a hover crosshair.
const chart = { hover: null };
function drawChart() {
  const col = app.col, cv = $('popChart');
  const w = cv.clientWidth, h = 120, dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const data = [...col.history, { t: col.time, w: col.workers.length }];
  const pad = { l: 26, r: 6, t: 10, b: 18 };
  const maxW = Math.max(5, ...data.map(d => d.w));
  const nice = Math.ceil(maxW / 5) * 5;
  const t0 = data[0].t, t1 = Math.max(t0 + 1, data[data.length - 1].t);
  const X = t => pad.l + (t - t0) / (t1 - t0) * (w - pad.l - pad.r);
  const Y = v => h - pad.b - v / nice * (h - pad.t - pad.b);
  ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
  ctx.fillStyle = 'rgba(243,235,221,0.5)'; ctx.strokeStyle = 'rgba(243,235,221,0.08)'; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const v of [0, nice / 2, nice]) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v) + 0.5); ctx.lineTo(w - pad.r, Y(v) + 0.5); ctx.stroke();
    ctx.fillText(String(v), pad.l - 6, Y(v));
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${Math.floor(t0 / DAY) + 1}日目`, pad.l, h - 4);
  ctx.textAlign = 'right'; ctx.fillText(`${Math.floor(t1 / DAY) + 1}日目`, w - pad.r, h - 4);
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, 'rgba(169,199,122,0.28)'); grad.addColorStop(1, 'rgba(169,199,122,0)');
  ctx.beginPath();
  data.forEach((d, i) => (i ? ctx.lineTo(X(d.t), Y(d.w)) : ctx.moveTo(X(d.t), Y(d.w))));
  ctx.lineTo(X(t1), Y(0)); ctx.lineTo(X(t0), Y(0)); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  data.forEach((d, i) => (i ? ctx.lineTo(X(d.t), Y(d.w)) : ctx.moveTo(X(d.t), Y(d.w))));
  ctx.strokeStyle = '#a9c77a'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  const tip = $('chartTip');
  if (chart.hover !== null) {
    const t = t0 + (chart.hover - pad.l) / (w - pad.l - pad.r) * (t1 - t0);
    let best = data[0];
    for (const d of data) if (Math.abs(d.t - t) < Math.abs(best.t - t)) best = d;
    const x = X(best.t), y = Y(best.w);
    ctx.strokeStyle = 'rgba(243,235,221,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 0.5, pad.t); ctx.lineTo(x + 0.5, h - pad.b); ctx.stroke();
    ctx.fillStyle = '#a9c77a'; ctx.strokeStyle = '#201a14'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    tip.hidden = false;
    tip.textContent = `${fmtStamp(best.t)} · ${best.w}匹`;
    tip.style.left = `${Math.max(60, Math.min(w - 60, x))}px`;
    tip.style.top = `${Math.max(-26, y - 34)}px`;
  } else tip.hidden = true;
}
$('popChart').addEventListener('pointermove', e => { chart.hover = e.offsetX; drawChart(); });
$('popChart').addEventListener('pointerleave', () => { chart.hover = null; drawChart(); });

// ------------------------------------------------------------------ tools & controls
function setTool(tool) {
  app.tool = tool;
  document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.tool === tool)));
  canvas.classList.toggle('placing', tool !== 'look');
  const hint = $('hint');
  if (tool !== 'look') {
    hint.hidden = false;
    hint.textContent = `地面をクリックして${FOODS[tool].name}を置く · Escで観察にもどる`;
  } else { hint.hidden = true; renderer.ghost = null; }
}
document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

function setSpeed(speed) {
  app.speed = speed;
  document.querySelectorAll('.speed-btn').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed)));
  if (app.paused) togglePause(false);
}
document.querySelectorAll('.speed-btn').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
function togglePause(force) {
  app.paused = force ?? !app.paused;
  $('playBtn').innerHTML = `<svg class="ico"><use href="#i-${app.paused ? 'play' : 'pause'}"/></svg>`;
  $('playBtn').setAttribute('aria-label', app.paused ? '再開' : '一時停止');
  $('playBtn').title = app.paused ? '再開 (Space)' : '一時停止 (Space)';
}
$('playBtn').addEventListener('click', () => togglePause());
function togglePher() {
  renderer.showPheromone = !renderer.showPheromone;
  $('pherBtn').setAttribute('aria-pressed', String(renderer.showPheromone));
}
$('pherBtn').addEventListener('click', togglePher);
function toggleLabels() {
  renderer.showLabels = !renderer.showLabels;
  $('labelBtn').setAttribute('aria-pressed', String(renderer.showLabels));
}
$('labelBtn').addEventListener('click', toggleLabels);
$('fitBtn').addEventListener('click', () => renderer.fit(true));
$('queenBtn').addEventListener('click', () => {
  const q = app.col.queen;
  if (!q) return toast('女王はもういません', 'warn');
  select(q);
  renderer.follow(q);
  renderer.cam.zoom = Math.max(renderer.cam.zoom, 3.2);
});
$('notebookBtn').addEventListener('click', () => openNotebook($('notebook').hidden));
$('notebookClose').addEventListener('click', () => openNotebook(false));
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

$('colonyName').addEventListener('click', () => {
  const name = prompt('巣の名前', app.col.name);
  if (name && name.trim()) { app.col.name = name.trim().slice(0, 24); $('colonyName').textContent = app.col.name; save(); }
});

// Menu
$('menuBtn').addEventListener('click', e => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; });
document.addEventListener('click', e => { if (!$('menu').contains(e.target)) $('menu').hidden = true; });
$('menu').addEventListener('click', e => {
  const action = e.target.closest('button')?.dataset.action;
  $('menu').hidden = true;
  if (action === 'new') $('newDialog').showModal();
  if (action === 'help') $('helpDialog').showModal();
  if (action === 'export') exportData();
  if (action === 'import') $('importFile').click();
});
$('newDialog').addEventListener('close', () => {
  if ($('newDialog').returnValue !== 'ok') return;
  const form = $('newDialog').querySelector('form');
  const name = form.name.value.trim() || 'わたしのアリの巣';
  const mode = form.mode.value;
  start(Colony.create({ mode, name }));
  setSpeed(mode === 'queen' ? 10 : 1);
  save();
});
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'ant-garden', colony: app.col.serialize() })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${app.col.name}-${app.col.day}日目.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const col = Colony.restore(data.colony);
    if (!confirm(`「${col.name}」（${col.day}日目）を読み込みます。いまの巣は置き換えられます。`)) return;
    start(col); save();
  } catch { alert('このファイルは読み込めませんでした。'); }
});

// ------------------------------------------------------------------ pointer input
const pointers = new Map();
let drag = null, pinch = null;
function select(a) {
  renderer.selected = a ? a.id : null;
  if (!a) renderer.follow(null);
  if (a) openNotebook(true, 'ant'); else if (activeTab === 'ant') updateAntCard();
}
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 1) drag = { x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY, moved: false };
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    drag = null;
  }
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (p) { p.x = e.offsetX; p.y = e.offsetY; }
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    renderer.zoomAt(mx, my, d / pinch.d);
    renderer.pan(mx - pinch.mx, my - pinch.my);
    pinch = { d, mx, my };
    return;
  }
  if (drag) {
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (!drag.moved && Math.hypot(e.offsetX - drag.sx, e.offsetY - drag.sy) > 5) { drag.moved = true; canvas.classList.add('dragging'); renderer.follow(null); }
    if (drag.moved) renderer.pan(dx, dy);
    drag.x = e.offsetX; drag.y = e.offsetY;
    return;
  }
  hover(e.offsetX, e.offsetY);
});
function hover(x, y) {
  if (app.tool !== 'look') {
    const p = renderer.pickPlane(x, y);
    renderer.ghost = p ? { type: app.tool, x: p.x, z: p.z, ok: app.col.surface.canPlace(p.x, p.z) } : null;
  } else canvas.classList.toggle('over-ant', !!renderer.pickAnt(x, y));
}
function release(e) {
  const wasDrag = drag && drag.moved;
  pointers.delete(e.pointerId);
  canvas.classList.remove('dragging');
  if (pointers.size < 2) pinch = null;
  if (e.type === 'pointerup' && drag && !wasDrag) click(e.offsetX, e.offsetY);
  drag = null;
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', () => { if (!drag) renderer.ghost = null; });
function click(x, y) {
  const col = app.col;
  if (app.tool !== 'look') {
    const p = renderer.pickPlane(x, y);
    if (!p) { toast('餌は地面の上に置けます', 'warn'); return; }
    const f = col.placeFood(app.tool, p.x, p.z);
    if (!f) toast(col.surface.foods.filter(q => q.user).length >= 24 ? '置ける餌は24個までです' : 'そこには置けません', 'warn');
    else save();
    return;
  }
  select(renderer.pickAnt(x, y));
}
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  renderer.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); togglePause(); }
  else if (k === 'escape') { setTool('look'); select(null); }
  else if (['1', '2', '3', '4'].includes(k)) setSpeed([1, 3, 10, 30][Number(k) - 1]);
  else if (k === 'q' || k === 'w' || k === 'e' || k === 'r') setTool(USER_FOODS['qwer'.indexOf(k)]);
  else if (k === 'p') togglePher();
  else if (k === 'l') toggleLabels();
  else if (k === 'f') renderer.fit(true);
  else if (k === '+' || k === '=') renderer.zoomAt(renderer.vw / 2, renderer.vh / 2, 1.25);
  else if (k === '-') renderer.zoomAt(renderer.vw / 2, renderer.vh / 2, 0.8);
});

window.addEventListener('resize', () => { renderer.resize(); renderer.clampCam(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); last = performance.now(); });
window.addEventListener('pagehide', save);

let extinctEl = null;
function updateExtinct() {
  if (app.col.extinct && !extinctEl) {
    extinctEl = document.createElement('div');
    extinctEl.className = 'extinct';
    extinctEl.innerHTML = `<div class="glass"><h2 style="margin:0 0 6px">コロニーは幕を閉じました</h2><p class="muted" style="margin:0 0 16px">${app.col.day}日間の記録は観察ノートに残っています。</p><button class="btn primary">新しい巣をはじめる</button></div>`;
    extinctEl.querySelector('button').onclick = () => $('newDialog').showModal();
    document.body.append(extinctEl);
  } else if (!app.col.extinct && extinctEl) { extinctEl.remove(); extinctEl = null; }
}

// ------------------------------------------------------------------ boot
const restored = load();
start(restored || Colony.create({ mode: 'colony' }));
setSpeed(app.speed);
if (!restored) { $('helpDialog').showModal(); save(); }
requestAnimationFrame(frame);
