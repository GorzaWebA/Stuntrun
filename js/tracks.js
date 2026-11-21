// Campaign tracks, authored with the turtle script language (see track.js).
// Medal times [gold, silver, bronze] come from `node tools/simulate.mjs --medals`:
// gold ≈ the faster autopilot style + 3%, silver/bronze ≈ default autopilot +15% / +35%.
import { buildFromScript } from './track.js';

const RAW = [
  {
    id: 'launch-pad', name: 'Launch Pad', difficulty: 1,
    script: 'S*3 R2 S*2 P/5 PB/5 P/5 S*2 K S*4 L3 S*2 C S*3 K S*5 R2 S*3 F',
    medals: [24.5, 29.0, 34.0],
  },
  {
    id: 'open-yard', name: 'Open Yard', difficulty: 2,
    script: 'S*4 P/5 PC/5 <<PP >>PP P/5 PB/5 P*2/5 PL/3 P/3 S C S P/5 PJ/5 >>PP <<PC P*3/5 PWR/5 P/5 PR/3 P/3 S*2 F',
    medals: [19.5, 22.5, 27.0],
  },
  {
    id: 'loop-the-loop', name: 'Loop the Loop', difficulty: 2,
    script: 'S*2 B S OL S*2 R2 S C S*2 B S OR S*2 L2 S B S OL S*2 F',
    medals: [24.5, 29.5, 35.0],
  },
  {
    id: 'wall-street', name: 'Wall Street', difficulty: 2,
    script: 'S*2 U2 S*2 B S VL S*2 C S WL3 S*2 VR S D2 S*2 F',
    medals: [19.0, 21.5, 26.0],
  },
  {
    id: 'air-mail', name: 'Air Mail', difficulty: 3,
    script: 'S*2 B S BK G G G P*4/5 S*2 C S R2 S U2 S*2 K G G P*4/5 D2 S*3 BK G G G P*5/5 S F',
    medals: [26.0, 29.5, 35.0],
  },
  {
    id: 'topsy-turvy', name: 'Topsy Turvy', difficulty: 3,
    script: 'S*2 U2 S*2 B S INV S*2 C S CS S*2 R2 S*2 B S INV S*2 D2 S F',
    medals: [25.0, 28.5, 33.0],
  },
  {
    id: 'obstacle-course', name: 'Obstacle Course', difficulty: 3,
    script: 'S*2 U2 S P*2/5 PC/5 <<PP P/5 PJ/5 P*2/5 PWL/5 >>PP P/5 S C S P/5 PB/5 P/5 PJ/5 P*3/5 D2 S*2 F',
    medals: [16.5, 18.5, 22.0],
  },
  {
    id: 'corkscrew-canyon', name: 'Corkscrew Canyon', difficulty: 4,
    script: 'S*2 U2 S*2 B S CS S*2 C S WL3 S*2 B S CS S*2 OL S*2 WR3 S*2 D2 S*2 F',
    medals: [27.0, 31.5, 37.0],
  },
  {
    id: 'gravity-well', name: 'Gravity Well', difficulty: 4,
    script: 'S*2 B S OL S*2 C S U2 S*2 B S VR S*2 WR3 S*2 INV S*2 K G G P*5/5 S*2 D2 S*3 F',
    medals: [29.5, 33.0, 39.0],
  },
  {
    id: 'sky-circus', name: 'Sky Circus', difficulty: 5,
    script: 'S U2 S U2 S*3 B S VL S*2 BK G G G P*5/5 S C S*3 B S WR3 S*2 CS S*2 K G G P*4/3 S INV S*2 D2 S D2 S*3 F',
    medals: [37.0, 42.0, 49.0],
  },
  {
    id: 'grand-stunt', name: 'Grand Stunt', difficulty: 5,
    script: 'S*2 B S OL S*2 R2 S U2 S*2 B S CS S*2 C S WL3 S*2 VR S*2 K G G P*2/5 PC/5 P/5 INV S*2 WR3 S*2 B S VL S*2 C S D2 S*2 BK G G G P*3/5 PB/5 P*2/5 L3 S*2 B S OR S*3 F',
    medals: [57.5, 64.0, 76.0],
  },
];

export const CAMPAIGN = RAW.map((t) => ({ ...t, pieces: buildFromScript(t.script) }));
