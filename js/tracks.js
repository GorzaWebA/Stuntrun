// Campaign tracks, authored with the turtle script language (see track.js).
// Medal times [gold, silver, bronze] are derived from the autopilot runs in
// tools/simulate.mjs (gold ≈ autopilot time + 2%).
import { buildFromScript } from './track.js';

const RAW = [
  {
    id: 'first-gear', name: 'First Gear', difficulty: 1,
    script: 'S*3 R2 S*2 B S*2 L3 S U S*2 C S D S*2 L2 S*3 R1 S R1 S*2 F',
    medals: [21.5, 24.0, 28.0],
  },
  {
    id: 'loop-lagoon', name: 'Loop Lagoon', difficulty: 2,
    script: 'S*2 B S OL S*2 R2 S C S L2 S B S OR S*2 L3 F',
    medals: [19.5, 22.0, 26.0],
  },
  {
    id: 'banked-bends', name: 'Banked Bends', difficulty: 2,
    script: 'S*3 BR3 S*2 BL3 S*2 BR2 S C S*2 BR3 S*4 BL2 S*2 B S BR3 S*3 F',
    medals: [24.5, 27.5, 33.0],
  },
  {
    id: 'sky-bridge', name: 'Sky Bridge', difficulty: 3,
    script: 'S*2 U U2 S C S K G G S*3 R2 S*2 K G G S*3 B S K G G S*2 D2 D S*2 F',
    medals: [20.0, 23.0, 27.0],
  },
  {
    id: 'twin-loops', name: 'Twin Loops', difficulty: 3,
    script: 'S*2 B S OL OR S*2 C S*2 R3 S B S OR S*2 L2 S*2 F',
    medals: [21.5, 24.0, 29.0],
  },
  {
    id: 'hairpin-hill', name: 'Hairpin Hill', difficulty: 4,
    script: 'S*2 U S L1 L1 U S R1 R1 U S BL2 S C S BL2 S D S R2 D S*2 B S F',
    medals: [24.0, 27.0, 32.0],
  },
  {
    id: 'big-air', name: 'Big Air', difficulty: 4,
    script: 'S U2 S*2 U2 S*4 K G G G S*3 C S*2 D2 S*5 BL3 S*2 U2 S*2 K G G S*4 D2 S*2 D2 S F',
    medals: [29.0, 32.5, 38.0],
  },
  {
    id: 'grand-stunt', name: 'Grand Stunt', difficulty: 5,
    script: 'S*2 B S OL S*2 U2 S*3 K G G S*4 BR3 S*2 C S D2 S*3 BL2 S B S OR S*3 R2 U S*2 K G G S*3 D S*3 C S L3 S*2 BR2 S B S OL S*3 F',
    medals: [48.0, 54.0, 64.0],
  },
];

export const CAMPAIGN = RAW.map((t) => ({ ...t, pieces: buildFromScript(t.script) }));
