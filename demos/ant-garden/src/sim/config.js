// World geometry. One world unit ≈ 0.5 mm (a worker is ~9 units long).
// The scene is a diorama: a ground plane (x, z) seen at an angle, cut open at
// z = 0 to reveal the soil cross-section (x, y) where the nest is dug.
export const W = 1280;            // world width
export const CELL = 4;            // soil grid resolution
export const SOIL_H = 720;        // soil depth shown in the cross-section
export const COLS = W / CELL;     // 320
export const ROWS = SOIL_H / CELL; // 180
export const SURF_D = 360;        // depth of the ground plane (z)
export const FORE = 0.48;         // ground plane foreshortening (screen y = -z * FORE)
export const SKY_H = 150;         // backdrop height above the far edge
export const PX_PER_CM = 20;

export const ENTRANCE = { x: 562, z: 14 };
export const ENTRANCE_COL = Math.floor(ENTRANCE.x / CELL);
export const MIDDEN = { x: 770, z: 210 };

export const STEP = 0.05;         // fixed simulation step (s)
export const DAY = 600;           // seconds per in-game day at 1x
export const MAX_ADULTS = 280;
export const YEAR_DAYS = 28;      // four 7-day seasons
export const YEAR_OFFSET = 3;     // a new colony starts in mid-spring
export const SEASON_NAMES = ['春', '夏', '秋', '冬'];

export const EGG_TIME = 100;
export const LARVA_TIME = 160;
export const PUPA_TIME = 120;

export const HARDNESS = [0, 1.0, 1.15, 1.6, 0.85, 1.9];
export const SOIL_NAMES = ['', '腐葉土', '黒土', '赤土', '砂', '粘土'];
export const ROCK = 9;

export const FOODS = {
  honey:   { name: '蜂蜜',     kind: 'sugar',   amount: 120, radius: 9,  scent: 75, harvest: 3.0 },
  apple:   { name: 'りんご',   kind: 'sugar',   amount: 90, radius: 12, scent: 85, harvest: 3.4 },
  cricket: { name: 'コオロギ', kind: 'protein', amount: 70, radius: 14, scent: 95, harvest: 4.4 },
  seeds:   { name: '種',       kind: 'seed',    amount: 36, radius: 11, scent: 60, harvest: 1.2 },
  bug:     { name: '小さな虫', kind: 'protein', amount: 8,  radius: 5,  scent: 46, harvest: 4.0, natural: true },
  nectar:  { name: '花の蜜',   kind: 'sugar',   amount: 10, radius: 5,  scent: 42, harvest: 3.0, natural: true },
  grass:   { name: '草の種',   kind: 'seed',    amount: 6,  radius: 6,  scent: 38, harvest: 1.2, natural: true },
};
export const USER_FOODS = ['honey', 'apple', 'cricket', 'seeds'];

export const ROLE_NAMES = {
  royal: '女王の部屋', brood: '育児室', food: '食料庫', rest: '休憩室', dig: '掘削中の部屋',
};

export const TASK_NAMES = {
  queen: '卵を産んでいます', found: '巣づくりの場所を探しています',
  alate: '結婚飛行の日を待っています', fly: '結婚飛行', guard: '入口で見守っています',
  rest: 'ひと休み', nurse: '子育て', dig: '巣を掘っています', forage: '餌さがし',
  undertake: '仲間を弔っています', move: '引っ越し中',
};

export const STATE_NAMES = {
  'dig:pick': '掘る場所を選んでいます', 'dig:go': '掘削現場へ向かっています',
  'dig:dig': '土を掘っています', 'dig:out': '土を地上へ運んでいます',
  'dig:dump': '土を捨てる場所へ', 'dig:back': '巣へ戻っています',
  'forage:out': '地上へ向かっています', 'forage:search': '餌を探しています',
  'forage:approach': '餌を見つけました', 'forage:harvest': '餌を集めています',
  'forage:home': '餌を巣へ運んでいます', 'forage:store': '食料庫へ運んでいます',
  'forage:return': '手ぶらで帰っています',
  'nurse:go': '子どもたちのところへ', 'nurse:tend': '幼虫に餌をあげています',
  'nurse:fetch': '子どもを迎えに行っています', 'nurse:carry': '子どもを運んでいます',
  'rest:go': '休む場所へ', 'rest:idle': 'ひと休み',
  'undertake:go': '亡くなった仲間のもとへ', 'undertake:carry': '亡骸を運んでいます',
  'undertake:back': '巣へ戻っています',
  'queen:stay': '卵を産んでいます', 'move:go': '新しい部屋へ移っています',
  'found:walk': '巣づくりの場所を探しています', 'found:dewing': '翅を落としています',
  'alate:go': '巣の中で待機しています', 'alate:idle': '結婚飛行の日を待っています',
  'fly:out': '地上へ向かっています', 'fly:climb': '飛び立つ場所を探しています',
  'fly:wing': '翅をふるわせています', 'fly:up': '空へ飛び立ちました',
  'guard:out': '入口へ向かっています', 'guard:watch': '入口で見守っています', 'guard:back': '巣へ戻っています',
};
