// Campaign tracks, authored with the turtle script language (see track.js).
// Medal times [gold, silver, bronze] come from `node tools/simulate.mjs --medals`:
// gold ≈ the faster autopilot style + 3%, silver/bronze ≈ default autopilot +15% / +35%.
//
// Layout rules for the heavy car (limits from `node tools/handling.mjs`,
// checked by `node tools/lint.mjs`):
// - Pick the turn for the speed you arrive with. Flat out on a straight is
//   about 190 km/h: after a long straight use wide or banked turns (L3 150,
//   BL3 165 km/h), normal turns (L2 125) only after something slow. No tight
//   turns (L1 85) in the campaign.
// - The braking a turn asks for grows with the act: at most 25 km/h in act 1,
//   up to 75 km/h in the finale. Real braking points get 3-2-1 boards (BRK).
// - Stunts get a straight, settled run-in: boosters before upside-down
//   sections (115 km/h minimum), never a corkscrew straight out of a turn.
// - Open floor only comes as arenas, and every arena has a reason to be
//   there: a jump over wrecks, a chicane, a corner with a sand trap, or a
//   landing zone after a big jump.
import { buildFromScript } from './track.js';

const RAW = [
  {
    // Wide sweepers you can take flat out, two kickers, and the show's first
    // jump over the wrecks.
    id: 'launch-pad', name: 'Opening Act', difficulty: 1,
    script: 'S*3 R3 S*3 K S*3 BL3 S*2 C S*3 AJ S*3 BL3 S*2 K S*3 BR3 S*2 F',
    medals: [28.0, 32.5, 39.0],
  },
  {
    // Every arena in one yard: a corner round the tyre wall, the wreck jump,
    // the corner back, then the chicane.
    id: 'open-yard', name: 'The Yard', difficulty: 2,
    script: 'S*3 ATL S*2 AJ S*2 ATR S*2 C S*2 AC S*3 F',
    medals: [22.0, 26.5, 31.0],
  },
  {
    // Three boosted loops linked by wide turns.
    id: 'loop-the-loop', name: 'Loop the Loop', difficulty: 2,
    script: 'S*2 B S OL S*2 R3 S C S*2 B S OL S*2 L3 S B S OL S*2 F',
    medals: [25.0, 30.0, 35.0],
  },
  {
    id: 'wall-street', name: 'Wall of Death', difficulty: 2,
    script: 'S*2 U2 S*2 B S VL S*2 C S WL3 S*2 VR S D2 S*2 F',
    medals: [19.0, 21.5, 26.0],
  },
  {
    // Big jumps into landing arenas. The corner between them is a wall turn
    // up on the stilts, so you keep your speed for the next jump.
    id: 'air-mail', name: 'Canyon Jump', difficulty: 3,
    script: 'S*2 B S BK G G G AL S*2 C S U2 S WR3 S*2 K G G AL D2 S*3 BK G G G AL S F',
    medals: [25.0, 28.5, 33.0],
  },
  {
    // Two upside-down runs with a corkscrew and a wall turn between them.
    id: 'topsy-turvy', name: 'Ceiling Run', difficulty: 3,
    script: 'S*2 U2 S*2 B S INV S*2 C S CS S*2 WR3 S*2 B S INV S*2 D2 S F',
    medals: [25.0, 27.5, 33.0],
  },
  {
    // The arenas up on stilts, back to back: corner, chicane, corner, jump.
    id: 'obstacle-course', name: 'Obstacle Course', difficulty: 3,
    script: 'S*2 U2 S ATL S C S AC S*2 ATR S*2 AJ S*3 D2 S*2 F',
    medals: [25.0, 29.0, 34.0],
  },
  {
    id: 'corkscrew-canyon', name: 'Corkscrew', difficulty: 4,
    script: 'S*2 U2 S*2 B S CS S*2 C S WL3 S*2 B S CS S*2 OL S*2 WR3 S*2 D2 S*2 F',
    medals: [27.0, 31.5, 37.0],
  },
  {
    // Loop, then wall turn into wall ride into ceiling, then a jump to land.
    id: 'gravity-well', name: 'Free Fall', difficulty: 4,
    script: 'S*2 B S OL S*2 C S U2 S*2 B S WR3 S*2 VR S*2 INV S*2 K G G AL S*2 D2 S*3 F',
    medals: [28.0, 32.0, 38.0],
  },
  {
    // Four levels up: a wall ride, a big jump, a corkscrew, a jump and a
    // ceiling run, all without touching the ground.
    id: 'sky-circus', name: 'High Wire', difficulty: 5,
    script: 'S U2 S U2 S*3 B S VL S*2 BK G G G AL S*2 C S*3 B S WR3 S*2 CS S*2 K G G AL S INV S*2 D2 S D2 S*3 F',
    medals: [37.0, 42.0, 49.0],
  },
  {
    // The whole show: loop, corkscrew, wall turn, wall ride, jump, ceiling,
    // the wreck jump and a last loop. One real braking point, signposted.
    id: 'grand-stunt', name: 'Grand Finale', difficulty: 5,
    script: 'S*2 B S OL S*2 R3 S U2 S*2 B S CS S*2 C S WL3 S*2 VR S*2 K G G AL INV S*2 WR3 S*2 B S VL S*2 C S D2 S*2 AJ BRK BL3 S*2 B S OR S*3 F',
    medals: [54.5, 61.0, 72.0],
  },
];

export const CAMPAIGN = RAW.map((t) => ({ ...t, pieces: buildFromScript(t.script) }));
