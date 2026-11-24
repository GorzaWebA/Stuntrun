// Handling "feel" report: turns how the car drives into numbers, so tuning
// can be judged without a controller. Usage:
//   node tools/feel.mjs                  current car
//   node tools/feel.mjs --set=gripLat=2,yawAssist=2   try other values
//   node tools/feel.mjs --wall           only the wall ride checks
import { Vector3 } from '../vendor/three.module.min.js';
import { buildTrack, computeRoute, buildFromScript } from '../js/track.js';
import { Race } from '../js/race.js';
import { Bot } from '../js/bot.js';
import { CAR } from '../js/car.js';

const KMH = 3.6, DEG = 180 / Math.PI;
const args = process.argv.slice(2);
const setArg = args.find((a) => a.startsWith('--set='));
if (setArg) {
  for (const kv of setArg.slice(6).split(',')) {
    const [k, v] = kv.split('=');
    if (!(k in CAR)) throw new Error(`unknown car parameter ${k}`);
    CAR[k] = Number(v);
  }
}

// ---- open-floor manoeuvres ---------------------------------------------------
const FLOOR = { pieces: buildFromScript('S P*16/15 S F') };
let floorTrack = null;
function onFloor(kmh) {
  floorTrack ||= buildTrack(FLOOR, { gates: false });
  const race = new Race(floorTrack);
  race.begin();
  race.car.reset(new Vector3(0, 0.95, 80), race.car.quat.clone(), new Vector3(0, 0, kmh / KMH));
  for (let k = 0; k < 48; k++) race.step({ steer: 0, throttle: 0.4, brake: 0 }); // settle
  return race;
}
const yawOf = (car) => { const f = new Vector3(0, 0, 1).applyQuaternion(car.quat); return Math.atan2(f.x, f.z); };
const headingOf = (car) => Math.atan2(car.vel.x, car.vel.z);
const slideOf = (car) => car.slideAngle * DEG;
const unwrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 1. turn-in: full lock at 120 km/h, how fast the yaw rate builds
function turnIn() {
  const race = onFloor(120), car = race.car;
  const rates = [];
  for (let k = 0; k < 240; k++) { race.step({ steer: 1, throttle: 0.6, brake: 0 }); rates.push(Math.abs(car.angVel.dot(new Vector3(0, 1, 0).applyQuaternion(car.quat)))); }
  const final = rates[rates.length - 1];
  const t63 = rates.findIndex((r) => r >= 0.63 * final) / 240;
  return { t63, rate: final * DEG };
}

// 2. turning at speed: full lock for 1.5 s, how far the direction of travel turns
function sweep(kmh) {
  const race = onFloor(kmh), car = race.car;
  const h0 = headingOf(car);
  let maxSlide = 0;
  for (let k = 0; k < 360; k++) { race.step({ steer: 1, throttle: 1, brake: 0 }); maxSlide = Math.max(maxSlide, slideOf(car)); }
  return { turned: Math.abs(unwrap(headingOf(car) - h0)) * DEG, speed: car.speed * KMH, maxSlide };
}

// 3. lane change at 150 km/h: half lock one way, then the other, then let go
function laneChange() {
  const race = onFloor(150), car = race.car;
  const x0 = car.pos.x, y0 = yawOf(car);
  let maxSlide = 0, k = 0;
  const step = (n, steer) => { for (let i = 0; i < n; i++, k++) { race.step({ steer, throttle: 1, brake: 0 }); maxSlide = Math.max(maxSlide, slideOf(car)); } };
  step(110, 0.5); step(110, -0.5); step(60, 0);
  const offset = Math.abs(car.pos.x - x0);
  let wobble = 0;
  step(0, 0);
  for (let i = 0; i < 360; i++) { race.step({ steer: 0, throttle: 1, brake: 0 }); wobble = Math.max(wobble, Math.abs(car.angVel.y) * DEG); }
  return { offset, settledHeading: Math.abs(unwrap(yawOf(car) - y0)) * DEG, wobble, maxSlide };
}

// 4. weave: sine steering at 180 km/h, does it stay composed?
function weave() {
  const race = onFloor(180), car = race.car;
  let maxSlide = 0;
  for (let k = 0; k < 720; k++) {
    race.step({ steer: 0.7 * Math.sin((k / 240) * Math.PI * 2 * 0.9), throttle: 1, brake: 0 });
    maxSlide = Math.max(maxSlide, slideOf(car));
  }
  return { maxSlide, speed: car.speed * KMH };
}

// ---- track pieces ------------------------------------------------------------
// constant-speed run through a piece with the autopilot steering (see handling.mjs)
export function holdRun(script, kmh, noise = 0, seed = 1, { delay = 0.12, fullLockAt = Number(process.env.FULL_LOCK_AT || 8) } = {}) {
  // "@2 S*3 VL ..." builds the whole test two levels up (room for rolls, no ramp first)
  const lv = script.match(/^@(\d+)\s+/);
  const def = { pieces: buildFromScript(lv ? script.slice(lv[0].length) : script, lv ? { y: +lv[1] } : {}) };
  const race = new Race(buildTrack(def, { gates: false }));
  const route = computeRoute(def);
  const bot = new Bot(route.points, { latAccel: 1e9, brakeDecel: 1e9 });
  race.begin();
  const v = kmh / KMH;
  race.car.vel.copy(new Vector3(0, 0, 1).applyQuaternion(race.car.quat)).multiplyScalar(v);
  // a human-ish driver: analog steering, reacts 0.12 s late, a little unsteady
  let s = seed, wander = 0;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const lag = [];
  let worst = 0, hits = 0, maxRollRate = 0, worstAt = '', hitAt = '';
  while (race.time < 25) {
    const inp = bot.update(race.car);
    if (noise) {
      // angle to the aim point ahead, in degrees, as the player sees it 0.12 s late
      lag.push(bot.angle * DEG);
      const seen = lag.length > delay * 240 ? lag.shift() : 0;
      // the stick goes over in proportion to the error (full lock ~6° off),
      // with a little wander in the player's hands
      wander = wander * 0.9917 + (rnd() - 0.5) * noise * 0.035;
      inp.steer = Math.max(-1, Math.min(1, seen / fullLockAt + wander));
    }
    const sp = race.car.fwdSpeed;
    inp.throttle = sp < v ? 1 : 0;
    inp.brake = 0;
    const ev = race.step(inp);
    const car = race.car;
    const fwd = new Vector3(0, 0, 1).applyQuaternion(car.quat);
    maxRollRate = Math.max(maxRollRate, Math.abs(car.angVel.dot(fwd)) * DEG);
    if (bot.offTrack > worst) { worst = bot.offTrack; worstAt = def.pieces[route.points[bot.idx].piece].type; }
    if (car.impact > 4) { hits++; hitAt ||= `${def.pieces[route.points[bot.idx].piece].type}@${(car.speed * KMH).toFixed(0)}`; }
    if (ev.some((e) => e.type === 'finish')) return { ok: worst < 6.5 && hits === 0, worst, hits, maxRollRate, worstAt, hitAt };
    if (bot.offTrack > 14) break;
  }
  return { ok: false, worst, hits, maxRollRate, worstAt, hitAt };
}

function cornerLimit(script) {
  let best = 0;
  for (let k = 40; k <= 240; k += 10) if (holdRun(script, k).ok) best = k;
  return best;
}

function wallReport() {
  const out = [];
  for (const [name, script] of [['wall ride', '@2 S*3 VL S*3 F'], ['wide wall turn', '@2 S*3 WL3 S*3 F']]) {
    const rows = [];
    for (const kmh of [120, 160, 200, 230]) {
      const clean = holdRun(script, kmh);
      let ok = 0;
      const n = 12;
      for (let sd = 1; sd <= n; sd++) if (holdRun(script, kmh, 1, sd * 7919).ok) ok++;
      rows.push(`${kmh} km/h: roll ${clean.maxRollRate.toFixed(0).padStart(3)}°/s, ${clean.ok ? 'clean' : 'FAILS'}, sloppy driver ${ok}/${n}`);
    }
    out.push(`  ${name}\n    ${rows.join('\n    ')}`);
  }
  return out.join('\n');
}

// how often a slightly unsteady human gets through the situations the
// campaign uses, out of 12 runs each
export const ROBUST = [
  ['ramps', 'U2 S*8 D2 S*2 F', [120, 200]],
  ['turn', 'S*3 L2 S*4 F', [110]],
  ['wide turn', 'S*3 L3 S*4 F', [140]],
  ['S-bend', 'S*3 L3 S R3 S*4 F', [130]],
  ['wall ride', '@2 S*3 VL S*3 F', [160, 200, 230]],
  ['wall turn', '@2 S*3 WL3 S*3 F', [160, 200, 230]],
];
export function robustness() {
  const rows = [];
  let total = 0, max = 0;
  for (const [name, script, speeds] of ROBUST) {
    const cells = speeds.map((kmh) => {
      let ok = 0;
      for (let sd = 1; sd <= 12; sd++) if (holdRun(script, kmh, 1, sd * 7919).ok) ok++;
      total += ok; max += 12;
      return `${kmh}: ${String(ok).padStart(2)}/12`;
    });
    rows.push(`${name.padEnd(10)} ${cells.join('   ')}`);
  }
  return { rows, total, max };
}

const f1 = (v) => v.toFixed(1), f0 = (v) => v.toFixed(0);
if (import.meta.url === `file://${process.argv[1]}` && args.includes('--robust')) {
  const r = robustness();
  console.log(`human driver\n  ${r.rows.join('\n  ')}\n  total ${r.total}/${r.max}`);
  process.exit(0);
}
if (args.includes('--calibrate')) {
  for (const [name, sc] of [['straight', 'U2 S*8 D2 S*2 F'], ['wide turn', 'S*3 L3 S*4 F']]) {
    for (const kmh of [120, 200]) {
      let ok = 0;
      for (let sd = 1; sd <= 12; sd++) if (holdRun(sc, kmh, 1, sd * 7919).ok) ok++;
      console.log(`calibrate ${name} @${kmh}: sloppy ${ok}/12`);
    }
  }
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}` && !args.includes('--wall')) {
  const ti = turnIn();
  console.log(`turn-in at 120 km/h     yaw rate ${f0(ti.rate)}°/s, 63% reached in ${f1(ti.t63 * 1000 / 1000)} s`);
  for (const kmh of [100, 160, 200]) {
    const s = sweep(kmh);
    console.log(`full lock 1.5 s @${kmh}   turned ${f0(s.turned)}°, ${f0(s.speed)} km/h after, max slide ${f0(s.maxSlide)}°`);
  }
  const lc = laneChange();
  console.log(`lane change @150        moved ${f1(lc.offset)} m, heading off by ${f1(lc.settledHeading)}° after, wobble ${f0(lc.wobble)}°/s, max slide ${f0(lc.maxSlide)}°`);
  const w = weave();
  console.log(`weave @180              max slide ${f0(w.maxSlide)}°, ${f0(w.speed)} km/h`);
  const lim = (name, sc) => console.log(`corner limit ${name.padEnd(10)} ${cornerLimit(sc)} km/h`);
  lim('turn', 'S*3 L2 S*4 F');
  lim('wide turn', 'S*3 L3 S*4 F');
  lim('tight', 'S*3 L1 S*4 F');
}
if (import.meta.url === `file://${process.argv[1]}` && (args.includes('--wall') || args.includes('--all'))) console.log(`walls\n${wallReport()}`);
