// Headless test: drives every campaign track with the autopilot and checks
// that it can be finished. Usage: node tools/simulate.mjs [trackId] [--verbose]
import { buildTrack, computeRoute, findOverlaps, buildFromScript } from '../js/track.js';
import { Race } from '../js/race.js';
import { Bot } from '../js/bot.js';
import { CAMPAIGN } from '../js/tracks.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.find((a) => !a.startsWith('--'));
const scriptArg = args.find((a) => a.startsWith('--script='));

const STYLES = {
  default: {},
  cautious: { latAccel: 12, brakeDecel: 9 },
  aggressive: { latAccel: 21, brakeDecel: 14 },
};

// respawnAtCheckpoints: right after each checkpoint, go back to it (standing
// still) and carry on, to prove every checkpoint can be restarted from.
export function simulate(def, { verbose = false, maxTime = 240, style = {}, respawnAtCheckpoints = false } = {}) {
  const track = buildTrack(def, { gates: false });
  const route = computeRoute(def);
  if (!route || !route.finished) return { ok: false, reason: 'route does not reach a finish' };
  const race = new Race(track);
  const bot = new Bot(route.points, style);
  race.begin();
  let stuck = 0;
  let lastLog = -1;
  let respawns = 0;
  let maxSpeed = 0;
  while (race.time < maxTime) {
    const input = bot.update(race.car);
    const events = race.step(input);
    maxSpeed = Math.max(maxSpeed, race.car.speed);
    for (const e of events) {
      if (verbose && e.type === 'checkpoint') console.log(`   checkpoint ${e.count}/${race.checkpointCount} at ${e.time.toFixed(2)}s`);
      if (e.type === 'finish') return { ok: true, time: e.time, respawns, maxSpeed };
      if (e.type === 'checkpoint' && respawnAtCheckpoints) { race.respawn(); respawns++; }
    }
    if (verbose && Math.floor(race.time) !== lastLog) {
      lastLog = Math.floor(race.time);
      const c = race.car;
      console.log(`   t=${race.time.toFixed(1)} v=${(c.speed * 3.6).toFixed(0)}km/h pos=(${c.pos.x.toFixed(1)},${c.pos.y.toFixed(1)},${c.pos.z.toFixed(1)}) gnd=${c.grounded} prog=${(input.progress * 100).toFixed(1)}% off=${bot.offTrack.toFixed(1)}`);
    }
    if (race.car.speed < 1) stuck++; else stuck = 0;
    if ((bot.offTrack > 20 && race.car.grounded > 0) || bot.offTrack > 60 || stuck > 240 * 4) {
      return { ok: false, reason: `left the track at ${(bot.idx / route.points.length * 100).toFixed(0)}% (t=${race.time.toFixed(1)}s, pos ${race.car.pos.toArray().map((v) => v.toFixed(1))})` };
    }
  }
  return { ok: false, reason: 'timeout' };
}

let failed = 0;
const list = scriptArg
  ? [{ id: 'script', name: 'script', pieces: buildFromScript(scriptArg.slice(9)) }]
  : CAMPAIGN.filter((t) => !only || t.id === only);
for (const t of list) {
  const overlaps = findOverlaps(t.pieces);
  const t0 = performance.now();
  const res = simulate(t, { verbose });
  // every checkpoint has to work as a standing restart
  const rs = simulate(t, { respawnAtCheckpoints: true });
  if (!rs.ok) { failed++; console.log(`FAIL ${t.id.padEnd(12)} restarting from a checkpoint: ${rs.reason}`); }
  if (args.includes('--styles')) {
    for (const name of ['cautious', 'aggressive']) {
      const r = simulate(t, { style: STYLES[name] });
      console.log(`     ${name.padEnd(10)} ${r.ok ? `${r.time.toFixed(2)}s` : `FAIL ${r.reason}`}`);
      if (!r.ok && name === 'cautious') failed++;
    }
  }
  const ms = performance.now() - t0;
  if (overlaps.length) console.log(`  ! ${t.id}: ${overlaps.length} overlapping cells`, overlaps.slice(0, 4));
  if (res.ok) {
    const medals = t.medals ? ` medals g/s/b=${t.medals.map((m) => m.toFixed(1)).join('/')}` : '';
    const half = (v) => Math.ceil(v * 2) / 2;
    const fast = args.includes('--medals') ? simulate(t, { style: STYLES.aggressive }) : null;
    const best = fast && fast.ok ? Math.min(fast.time, res.time) : res.time;
    const suggest = [half(best * 1.03), half(res.time * 1.15), Math.ceil(res.time * 1.35)];
    if (args.includes('--medals')) console.log(`  suggested medals: [${suggest.map((v) => v.toFixed(1)).join(', ')}]`);
    console.log(`ok   ${t.id.padEnd(12)} ${res.time.toFixed(2)}s  vmax=${(res.maxSpeed * 3.6).toFixed(0)}km/h  pieces=${t.pieces.length}${medals}  (${ms.toFixed(0)}ms)`);
  } else {
    failed++;
    console.log(`FAIL ${t.id.padEnd(12)} ${res.reason}`);
  }
}
if (failed) process.exitCode = 1;
