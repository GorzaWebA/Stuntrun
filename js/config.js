// Global constants shared by the whole game.

export const TILE = 20;          // horizontal size of one track tile (metres)
export const LEVEL = 5;          // height of one build level (metres)
export const ROAD_HALF = 8;      // half width of a track deck
export const CURB_W = 0.8;       // width of the raised curb on each side
export const LINE_W = 0.4;       // white edge line width
export const DECK_T = 0.6;       // deck thickness below the road surface
export const GROUND_Y = -0.3;    // height of the grass plane
export const PHYS_DT = 1 / 240;  // fixed physics timestep
// Bump when the handling changes so old best times / ghosts are not compared.
export const PHYSICS_VERSION = 3;

export const COLORS = {
  asphalt: 0x3d3542,      // warm charcoal road
  line: 0xf6ead2,         // bone edge lines
  curbA: 0xe23b2e,        // show red
  curbB: 0xf6ead2,        // bone
  curbWall: 0xd9cbb0,
  side: 0xffc42e,         // marquee yellow track structure
  bottom: 0xb9800f,
  boostA: 0xff6a1f,
  boostB: 0xffc42e,
  pillar: 0xeadcc0,
  pillarBase: 0xc9b493,
  gateFrame: 0x2a1f33,    // ink
  start: 0xe23b2e,
  checkpoint: 0x2a9d9a,   // canyon teal
  checkpointDone: 0xffc42e,
  finishA: 0x2a1f33,
  finishB: 0xf6ead2,
}

// Paint jobs: show red, marquee, teal, bone, ink, sky, mint, plum
export const CAR_COLORS = [
  0xe23b2e, 0xffc42e, 0x2a9d9a, 0xf6ead2, 0x2a1f33, 0x4b8fd6, 0x8fd1a8, 0x9a4f9e,
];
