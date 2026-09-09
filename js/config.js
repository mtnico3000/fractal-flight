// Shared constants. The MB_* values used by the CPU terrain mirror are
// hardcoded in terrain.js and must match the fragment shader (shaders.js).

export const FOV_DEG = 70;
export const TAN_HALF_FOV = Math.tan(FOV_DEG * 0.5 * Math.PI / 180);
export const WATER_LEVEL = -8.0;
export const START = { x: 0, y: 480, z: 0 };

// flight / collision
export const GRIND_DEPTH = 3.4;   // meters of scrape band below first ground contact

// ring course
export const MAX_RINGS = 8;
export const LAND_MIN_H = 30;     // minimum terrain height (m) to anchor a ring over land

// guns / bombs
export const MAXB = 8;
export const BULLET_SPEED = 420;  // muzzle velocity, added on top of the craft's speed
export const BULLET_RANGE = 1600; // meters of flight before the tracer burns out
export const MAXBOMB = 3;
export const BLAST_R = 100;       // meters: everything poppable inside this radius dies
export const BLASTC = 64;         // max cells one detonation can query
export const HULL_BLAST_R = 70;  // meters: visual radius of the air-burst ring on an alien hull
export const RING_N = 28;         // ring vertices for the ground-conforming blast circle
export const BOMB_BOOST = 40;     // horizontal speed on top of the plane's own speed

// clouds / fx
export const MAXCLOUD = 16;
export const TRAIL_LIFE = 4.5;   // v7.4: contrails linger — the plane reads from afar
export const POP_LIFE = 0.7;
