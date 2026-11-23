// Prints a top-down ASCII map of a track script or campaign track.
// Usage: node tools/map.mjs <trackId>   |   node tools/map.mjs --script="S S L2 ..."
import { buildFromScript, findOverlaps } from '../js/track.js';
import { worldCells } from '../js/pieces.js';
import { CAMPAIGN } from '../js/tracks.js';

const arg = process.argv[2] || '';
const pieces = arg.startsWith('--script=') ? buildFromScript(arg.slice(9)) : CAMPAIGN.find((t) => t.id === arg)?.pieces;
if (!pieces) { console.log('ids:', CAMPAIGN.map((t) => t.id).join(', ')); process.exit(1); }
const CH = { start: 'S', finish: 'F', checkpoint: 'C', straight: '#', boost: '>', turn1: 't', turn2: 'T', turn3: 'T', bank2: 'b', bank3: 'B', ramp: '/', ramp2: '/', kicker: 'K', loopL: 'O', loopR: 'O', bigkick: 'J', wall2: 'w', wall3: 'W', wallL: '|', wallR: '|', corkscrew: '@', inverted: 'U', plaza: 'o', plazaPillar: 'X', plazaWall: '=', plazaCones: 'c', plazaBumps: 'b', plazaJump: 'j', arenaJump: 'A', arenaChicane: 'Z', arenaTurn: 'R', arenaLanding: 'L', brake3: '3', brake2: '2', brake1: '1' };
const grid = new Map();
let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
pieces.forEach((p) => {
  for (const [x, z, y] of worldCells(p)) {
    const k = `${x},${z}`;
    const prev = grid.get(k);
    if (!prev || y >= prev.y) grid.set(k, { y, c: CH[p.type] });
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
});
for (let z = maxZ; z >= minZ; z--) {
  let row = String(z).padStart(4) + ' ';
  for (let x = maxX; x >= minX; x--) {
    const g = grid.get(`${x},${z}`);
    row += g ? g.c + (g.y > 9 ? '+' : g.y) : ' .';
  }
  console.log(row);
}
console.log('pieces', pieces.length, 'overlaps', findOverlaps(pieces).length);
