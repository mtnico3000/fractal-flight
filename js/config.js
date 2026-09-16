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

// ---- fx occlusion-query slot map -------------------------------------------
// The GPU probe row answers "is this overlay particle hidden?" for FXQ world
// points (shader: uFxPos[FXQ], probe row px 85 .. 85+FXQ-1). FXQ is a HARD
// budget, not a preference: the array is already 48 of the shader's measured
// 245 vec4 uniform slots against a GLSL ES 3.0 guarantee of 224, so the way to
// give an effect more coverage is to RE-CUT this map, never to grow it. Each
// constant is the FIRST slot of its class; the class ends where the next
// begins, and FXQ ends the last one — so a boundary only has to move once.
//
// The rings share ONE pool rather than taking a fixed cut each, because they
// never peak together: impacts are gunfire, pops are harvests, and a single
// pool round-robins 21 slots over whichever family is actually busy instead of
// stranding 11 idle ones beside 10 oversubscribed.
export const FXQ_TRAIL  = 0;    // 16 samples along the contrail polyline
export const FXQ_BULLET = 16;   // one per tracer slot (MAXB)
export const FXQ_BOMB   = 24;   // one per bomb slot (MAXBOMB)
export const FXQ_RING   = 27;   // 21, ROUND ROBIN over every ring being drawn
export const FXQ        = 48;

// ---- sun travel (right-drag) -----------------------------------------------
// The floor is BELOW the horizon: the sun sets properly and the island goes
// dark. -0.72 rad is ~41 deg down, which is where the shader's SECOND night
// stage (deepNight) saturates and the last light leaves the sky -- past that
// point only the emissive things are still drawn, and dragging further would
// change nothing on screen. Keep this pinned just past deepNight's lower
// smoothstep edge; test_shader.js fails if the two drift apart.
export const SUN_EL_MIN = -0.72;
export const SUN_EL_MAX = 1.25;
