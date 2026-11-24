// Checks campaign tracks against what the heavy car can do. For every turn it
// prints how fast the autopilot arrives, the most it can carry through, and
// how much speed has to come off. Usage: node tools/lint.mjs [trackId]
import { buildTrack, computeRoute, buildFromScript, findOverlaps } from '../js/track.js';
import { Race } from '../js/race.js';
import { Bot } from '../js/bot.js';
import { CAMPAIGN } from '../js/tracks.js';

// constant-speed limits measured with tools/handling.mjs (km/h)
const LIMIT = {
  turn1: 100, turn2: 150, turn3: 170, bank2: 130, bank3: 250, wall2: 230, wall3: 250,
  arenaTurn: 150, arenaChicane: 120,
};
// minimum entry speeds for stunts (km/h)
const MIN = { loopL: 90, loopR: 90, wallL: 60, wallR: 60, corkscrew: 60, inverted: 70, wall3: 50 };
// how much braking a track of each difficulty may ask for going into a turn (km/h)
const MAX_DROP = [0, 25, 35, 45, 60, 75];

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('--'));
const scriptArg = args.find((a) => a.startsWith('--script='));
const diffArg = args.find((a) => a.startsWith('--difficulty='));
const list = scriptArg
  ? [{ id: 'script', name: 'Draft', difficulty: diffArg ? +diffArg.slice(13) : 3, pieces: buildFromScript(scriptArg.slice(9)) }]
  : CAMPAIGN.filter((x) => !only || x.id === only);
let problems = 0;
for (const t of list) {
  const overlaps = findOverlaps(t.pieces);
  if (overlaps.length) { problems++; console.log(`${t.name}: ${overlaps.length} overlapping cells`, overlaps.slice(0, 3)); }
  const track = buildTrack(t, { gates: false });
  const route = computeRoute(t);
  const race = new Race(track);
  const bot = new Bot(route.points);
  race.begin();
  const log = []; // per step: route index, speed
  let done = false;
  while (race.time < 200 && !done) {
    const input = bot.update(race.car);
    for (const e of race.step(input)) if (e.type === 'finish') done = true;
    log.push([bot.idx, race.car.speed * 3.6, race.car.grounded]);
  }
  const s = bot.s;
  const pieceAt = (i) => route.points[i].piece;
  const lines = [];
  const seen = new Set();
  for (let k = 0; k < log.length; k++) {
    const pi = pieceAt(log[k][0]);
    if (seen.has(pi)) continue;
    seen.add(pi);
    const type = t.pieces[pi].type;
    const v = log[k][1];
    if (LIMIT[type]) {
      // fastest speed in the 150 m before the turn
      let peak = v;
      for (let j = k; j >= 0 && s[log[k][0]] - s[log[j][0]] < 150; j--) peak = Math.max(peak, log[j][1]);
      // what a player has to shed: from the speed the straight gives them to the turn's limit
      const drop = Math.max(0, peak - LIMIT[type]);
      const flag = drop > MAX_DROP[t.difficulty] ? ' <-- too much braking for this act' : '';
      if (flag) problems++;
      lines.push(`  ${type.padEnd(13)} arrive ${peak.toFixed(0).padStart(3)} km/h, limit ${String(LIMIT[type]).padStart(3)}: shed ${drop.toFixed(0).padStart(3)}${flag}`);
    }
    if (MIN[type] && v < MIN[type]) {
      problems++;
      lines.push(`  ${type.padEnd(13)} enter ${v.toFixed(0)} km/h, needs ${MIN[type]} <-- too slow for the stunt`);
    }
  }
  if (!done) problems++;
  console.log(`${t.name} (${t.id}, difficulty ${t.difficulty})${done ? ` ${race.time.toFixed(1)} s` : '  DID NOT FINISH'}`);
  for (const l of lines) console.log(l);
}
if (problems) { console.log(`\n${problems} problem(s)`); process.exitCode = 1; }
