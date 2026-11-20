// Global constants shared by the whole game.

export const TILE = 20;          // horizontal size of one track tile (metres)
export const LEVEL = 5;          // height of one build level (metres)
export const ROAD_HALF = 8;      // half width of a track deck
export const CURB_W = 0.8;       // width of the raised curb on each side
export const LINE_W = 0.4;       // white edge line width
export const DECK_T = 0.6;       // deck thickness below the road surface
export const GROUND_Y = -0.3;    // height of the grass plane
export const PHYS_DT = 1 / 240;  // fixed physics timestep

export const COLORS = {
  asphalt: 0x3a4152,
  line: 0xeef1f6,
  curbA: 0xe8424f,
  curbB: 0xf4f6fa,
  curbWall: 0xc7ccd6,
  side: 0x8aa0c0,
  bottom: 0x58667f,
  boostA: 0xff7a1a,
  boostB: 0xffb52e,
  pillar: 0xb9c1cf,
  pillarBase: 0x8d97a8,
  gateFrame: 0x2b3448,
  start: 0x2ad37a,
  checkpoint: 0x22c3f0,
  checkpointDone: 0xffd23f,
  finishA: 0x111318,
  finishB: 0xf4f6fa,
};

export const CAR_COLORS = [
  0xff5a36, 0xffc233, 0x2ad37a, 0x22c3f0, 0x6c5cff, 0xff4fa3, 0xf4f6fa, 0x2b3448,
];
