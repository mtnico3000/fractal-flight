// The render settings the GAME reads, with the shipped behaviour baked in.
//
// These used to be read as TUNED.<knob>.v straight out of the Debug panel,
// which meant the panel -- and the whole diagnostic surface behind it -- had
// to exist for the game to run at all. Now this plain object IS the game's
// answer, and js/debug.js (loaded only in a --debug build) writes into it
// when a slider moves. With no debug module these values never change.
//
// Every value below is TUNED's own default, and test_dbg.js fails if the two
// ever disagree -- two copies of one truth is exactly the shape of bug that
// `v === d` was already written to catch.
export const DBG = {
  on:   false,   // a debug build loaded js/debug.js
  mask: 0,       // uDebugMask: the false-colour channel bits
  resScale:    0,   // resolution
  detailFade:  1,   // detail fade
  rayTol:      1,   // ray tol
  waterLOD:    0.8,   // water LOD
  hitRefine:   1,   // hit refine
  stride:      0.0002,   // march stride
  relaxMtn:    0.3,   // mtn relax
  invasion:    1,   // invasion
  ringsOn:     1,   // rings
  obsCam:      0,   // obs camera
};
