// Measures what the car can do, so tracks can be designed around it.
// For every turn and stunt piece it finds the speed window that works when
// the driver holds a constant speed through the piece (no braking inside):
//   max: fastest entry that stays off the barriers
//   min: slowest entry that still gets through (loops, walls, ceilings)
// It also prints braking distances. Takes a few minutes.
// Usage: node tools/handling.mjs [--fine] [--braking]
import { Vector3 } from '../vendor/three.module.min.js';
import { buildTrack, computeRoute, buildFromScript } from '../js/track.js';
import { Race } from '../js/race.js';
import { Bot } from '../js/bot.js';
import { CAR } from '../js/car.js';

const KMH = 3.6;

// Drives `script` holding `kmh`; returns whether the piece was cleared cleanly.
export function holdSpeedRun(script, kmh, { maxOff = 6.2 } = {}) {
  const def = { pieces: buildFromScript(script) };
  const track = buildTrack(def, { gates: false });
  const route = computeRoute(def);
  const race = new Race(track);
  const bot = new Bot(route.points, { latAccel: 1e9, brakeDecel: 1e9 });
  race.begin();
  const v = kmh / KMH;
  race.car.vel.copy(new Vector3(0, 0, 1).applyQuaternion(race.car.quat)).multiplyScalar(v);
  let worst = 0, hits = 0;
  while (race.time < 25) {
    const inp = bot.update(race.car);
    const sp = race.car.fwdSpeed;
    inp.throttle = sp < v ? 1 : 0;
    inp.brake = sp > v + 2 ? 0.3 : 0;
    const ev = race.step(inp);
    worst = Math.max(worst, bot.offTrack);
    if (race.car.impact > 3) hits++;
    if (ev.some((e) => e.type === 'finish')) return { ok: worst < maxOff && hits === 0, worst, hits };
    if (bot.offTrack > 14) break;
  }
  return { ok: false, worst, hits };
}

const STEP = process.argv.includes('--fine') ? 5 : 10;
function window(script, from = 30, to = 260, step = STEP, opts) {
  const ok = [];
  for (let k = from; k <= to; k += step) if (holdSpeedRun(script, k, opts).ok) ok.push(k);
  return ok.length ? { min: ok[0], max: ok[ok.length - 1], gaps: ok.length !== (ok[ok.length - 1] - ok[0]) / step + 1 } : null;
}

function brakingDistance(fromKmh, toKmh) {
  // straight-line full braking
  const def = { pieces: buildFromScript('S*30 F') };
  const race = new Race(buildTrack(def, { gates: false }));
  race.begin();
  race.car.vel.copy(new Vector3(0, 0, 1).applyQuaternion(race.car.quat)).multiplyScalar(fromKmh / KMH);
  race.step({ steer: 0, throttle: 1, brake: 0 });
  const p0 = race.car.pos.clone();
  while (race.car.fwdSpeed > toKmh / KMH && race.time < 20) race.step({ steer: 0, throttle: 0, brake: 1 });
  return race.car.pos.distanceTo(p0);
}

function accelDistance(toKmh) {
  const def = { pieces: buildFromScript('S*80 F') };
  const race = new Race(buildTrack(def, { gates: false }));
  race.begin();
  const p0 = race.car.pos.clone();
  while (race.car.fwdSpeed < toKmh / KMH && race.time < 30) race.step({ steer: 0, throttle: 1, brake: 0 });
  return { dist: race.car.pos.distanceTo(p0), time: race.time };
}

const PIECES = [
  ['L1 tight turn (r 10 m)', 'S*3 L1 S*4 F'],
  ['L2 turn (r 30 m)', 'S*3 L2 S*4 F'],
  ['L3 wide turn (r 50 m)', 'S*3 L3 S*4 F'],
  ['BL2 banked turn', 'S*3 BL2 S*4 F'],
  ['BL3 wide banked', 'S*3 BL3 S*4 F'],
  ['WL2 wall turn', 'U2 S*2 WL2 S*2 D2 S*2 F'],
  ['WL3 wide wall turn', 'U2 S*2 WL3 S*2 D2 S*2 F'],
  ['L2 then R2 (S-bend)', 'S*3 L2 R2 S*4 F'],
  ['L2 S R2 (S-bend + 1)', 'S*3 L2 S R2 S*4 F'],
  ['L3 R3 (wide S-bend)', 'S*3 L3 R3 S*4 F'],
  ['PL open-floor turn', 'S*3 P/3 PL/3 P/3 S*4 F'],
  ['OL loop', 'S*3 OL S*4 F'],
  ['VL wall ride', 'S*3 VL S*4 F'],
  ['CS corkscrew', 'U2 S*2 CS S*2 D2 S*2 F'],
  ['INV upside down', 'U2 S*2 INV S*2 D2 S*2 F'],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`car: ${CAR.mass} kg, top speed ${(CAR.topSpeed * KMH).toFixed(0)} km/h\n`);
  const only = process.argv.includes('--braking');
  if (!only) console.log('piece                       entry speed window (km/h, constant speed)');
  for (const [name, script] of only ? [] : PIECES) {
    const w = window(script);
    console.log(`${name.padEnd(28)}${w ? `${w.min}–${w.max}${w.gaps ? ' (with gaps)' : ''}` : 'never clean'}`);
  }
  console.log('\nbraking (full brake, straight)');
  for (const [a, b] of [[240, 160], [240, 120], [200, 120], [200, 90], [160, 90], [160, 60], [120, 60]]) {
    console.log(`  ${a} → ${b} km/h: ${brakingDistance(a, b).toFixed(0)} m`);
  }
  console.log('\nacceleration from a standstill');
  for (const v of [100, 150, 200, 215]) {
    const r = accelDistance(v);
    console.log(`  0 → ${v} km/h: ${r.dist.toFixed(0)} m, ${r.time.toFixed(1)} s`);
  }
}
