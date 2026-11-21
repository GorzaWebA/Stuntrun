// Campaign tracks, authored with the turtle script language (see track.js).
// Medal times [gold, silver, bronze] come from `node tools/simulate.mjs --medals`:
// gold ≈ the faster autopilot style + 3%, silver/bronze ≈ default autopilot +15% / +35%.
import { buildFromScript } from './track.js';

const RAW = [
  {
    id: 'launch-pad', name: 'Launch Pad', difficulty: 1,
    script: 'S*3 R2 S K S*4 L3 S*2 C S*3 K S*5 R2 S*3 F',
    medals: [18.0, 21.0, 25.0],
  },
  {
    id: 'loop-the-loop', name: 'Loop the Loop', difficulty: 2,
    script: 'S*2 B S OL S*2 R2 S C S*2 B S OR S*2 L2 S B S OL S*2 F',
    medals: [20.5, 24.5, 29.0],
  },
  {
    id: 'wall-street', name: 'Wall Street', difficulty: 2,
    script: 'S*2 U2 S*2 B S VL S*2 C S WL3 S*2 VR S D2 S*2 F',
    medals: [16.5, 19.0, 22.0],
  },
  {
    id: 'air-mail', name: 'Air Mail', difficulty: 3,
    script: 'S*2 B S BK G G G S*6 C S R2 S U2 S*2 K G G S*4 D2 S*3 BK G G G S*7 F',
    medals: [23.5, 27.0, 32.0],
  },
  {
    id: 'topsy-turvy', name: 'Topsy Turvy', difficulty: 3,
    script: 'S*2 U2 S*2 B S INV S*2 C S CS S*2 R2 S*2 B S INV S*2 D2 S F',
    medals: [22.5, 25.5, 30.0],
  },
  {
    id: 'corkscrew-canyon', name: 'Corkscrew Canyon', difficulty: 4,
    script: 'S*2 U2 S*2 B S CS S*2 C S WL3 S*2 B S CS S*2 OL S*2 WR3 S*2 D2 S*2 F',
    medals: [23.5, 27.5, 32.0],
  },
  {
    id: 'gravity-well', name: 'Gravity Well', difficulty: 4,
    script: 'S*2 B S OL S*2 C S U2 S*2 B S VR S*2 WR3 S*2 INV S*2 K G G S*4 D2 S*3 F',
    medals: [24.5, 28.0, 33.0],
  },
  {
    id: 'sky-circus', name: 'Sky Circus', difficulty: 5,
    script: 'S U2 S U2 S*3 B S VL S*2 BK G G G S*6 C S WR3 S*2 CS S*2 K G G S*4 INV S*2 D2 S D2 S*3 F',
    medals: [32.5, 36.5, 43.0],
  },
  {
    id: 'grand-stunt', name: 'Grand Stunt', difficulty: 5,
    script: 'S*2 B S OL S*2 R2 S U2 S*2 B S CS S*2 C S WL3 S*2 VR S*2 K G G S*4 INV S*2 WR3 S*2 B S VL S*2 C S D2 S*2 BK G G G S*6 L3 S*2 B S OR S*3 F',
    medals: [47.5, 55.0, 65.0],
  },
];

export const CAMPAIGN = RAW.map((t) => ({ ...t, pieces: buildFromScript(t.script) }));
