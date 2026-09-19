// Mutation battery — tests for the tests.  node test/mutants.js
//
// NOT part of run_tests.js: it is slow (one full test run per mutant) and it
// writes to js/ while it works. Run it after adding or changing a test.
//
// Why it exists. On 9 Sept 2026 the suite was green and two of its assertions
// were meaningless:
//
//   * test_shader's octave-fade check sliced each shader function with a fixed
//     700-char window. fbmLOD's body is ~413 chars, so the window ran into
//     fbmRLOD -- breaking fbmLOD's fade was answered green by its NEIGHBOUR's
//     mix(). The assertion had never tested fbmLOD at all.
//   * "a MELTING hull is inert" passed with melt removed from hullAlive
//     entirely, because a melting hull SINKS and slid out from under a craft
//     parked at its pre-update position. It was testing displacement.
//
// Neither is visible by reading the test. The only way to know an assertion
// works is to break the thing it names and watch it go red -- which is what
// this does. Every mutant below is a real bug someone could plausibly write.
//
// Safety: originals are held in memory and restored in a finally, and again on
// SIGINT, so an interrupted run does not leave js/ mutated. It still refuses to
// start if those files have uncommitted changes, because a crash between the
// write and the restore would otherwise be indistinguishable from your work.

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// A write can fail transiently on Windows (EBUSY/EPERM while another process
// has the file open -- it happened once, 13 Sept 2026, on js/aliens.js). A
// failed RESTORE would leave a mutant on disk, so retry a few times before
// giving up, and let the uncaughtException handler below restore everything.
const write = (f, s) => {
  for (let attempt = 0; ; attempt++) {
    try { return fs.writeFileSync(path.join(ROOT, f), s); }
    catch (e) {
      if (attempt >= 5) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
};

// [label, file, find, replace, test, all?]. `find` must appear at least once.
// Only the FIRST occurrence is replaced by default, so a mutant can target one
// of several copies -- that is exactly how the terrainCheapH escapes were
// found. Pass 'all' as a 6th element when the name is repeated and replacing
// one leaves the others to answer for it: CLAUDE.md names aliens.js four
// times, and a single-occurrence mutant there looked like a toothless test
// when it was really a toothless MUTANT.
const MUTANTS = [
  // --- A1: the footprint LOD split, and the collision authority -------------
  ['terrainShape stops being the px=0 collision authority', 'js/shaders.js',
   'return terrainShapeLOD(p, 0.0);', 'return terrainShapeLOD(p, px0);', 'test_shader.js'],
  ['fbmLOD fades toward 0.0 instead of the octave mean', 'js/shaders.js',
   'FBMLOD_MIX', 'mix(0.0, noise(p), w)', 'test_shader.js'],
  ['NOISE_MEAN retuned off the measured value', 'js/shaders.js',
   'NOISE_MEAN = 0.49', 'NOISE_MEAN = 0.60', 'test_shader.js'],

  // --- v9.5 terrain march: each of these is a bug that WAS shipped ---------
  // The first 384 loop in the file is marchTerrain's; the hull marches come
  // ~400 lines later, so first-occurrence targets the right one.
  ['terrain march budget cut back to 150 (grazing beach rays exhaust it)', 'js/shaders.js',
   'i < 384; i++) {', 'i < 150; i++) {', 'test_shader.js'],
  ['budget exhaustion is a hole again (became WATER over the beach)', 'js/shaders.js',
   'return vec2(t, (dP < dT) ? 4.0 : 1.0);', 'return vec2(-1.0, 0.0);', 'test_shader.js'],
  ['the refine extrapolates over a cresting bump', 'js/shaders.js',
   'pdT > dT && pdT < 1e4 && uHitRefine', 'pdT < 1e4 && uHitRefine', 'test_shader.js'],
  ['the minimum stride is hard-wired to the old 0.0018 again', 'js/shaders.js',
   't += d + t * uMarchStride;', 't += d + t * 0.0018;', 'test_shader.js'],
  ['the refine bound drops tolRay (beach residual 0.05 -> 0.34 m, silently)', 'js/shaders.js',
   't + max(2.0 * (t - pt), tolRay))', 't + 2.0 * (t - pt))', 'test_shader.js'],

  // --- render path: both of these fail silently ----------------------------
  ['fps counter goes back to the clamped physics dt', 'js/main.js',
   'fpsAcc += rawDt; fpsN++; fpsTimer += rawDt;', 'fpsAcc += dt; fpsN++; fpsTimer += dt;', 'test_render.js'],
  ['auto-scaler no longer stands down for a pinned resolution', 'js/main.js',
   'if (!manualRes) adjustQuality(fps);', 'if (true) adjustQuality(fps);', 'test_render.js'],
  ['supersample buffer unclamped from MAX_TEXTURE_SIZE', 'js/renderer.js',
   'const w = Math.round(canvas.clientWidth * DPR * renderScale * lim);',
   'const w = Math.round(canvas.clientWidth * DPR * renderScale);', 'test_render.js'],

  // --- the terrain mirror, drifting from EITHER side ------------------------
  ['mirror: w1 Mandelbrot scale drifts off MB_SCALE', 'js/terrain.js',
   'mandelDEJ(px * 2.5e-4 - 0.55, pz * 2.5e-4) / 2.5e-4',
   'mandelDEJ(px * 2.6e-4 - 0.55, pz * 2.6e-4) / 2.6e-4', 'test_terrain.js'],
  ['shader: MB_SCALE moved, mirror left behind', 'js/shaders.js',
   'const float MB_SCALE  = 2.5e-4;', 'const float MB_SCALE  = 2.6e-4;', 'test_terrain.js'],
  ['shader: lake valley high edge moved (mirror keeps the old span)', 'js/shaders.js',
   'smoothstep(0.58, 0.72, valley)', 'smoothstep(0.58, 0.80, valley)', 'test_terrain.js'],
  ['shader: tall-range amplitude top moved', 'js/shaders.js',
   'mix(0.42, 1.1, tall)', 'mix(0.42, 1.3, tall)', 'test_terrain.js'],
  ['mirror: escape iterations cut (coastlines move)', 'js/terrain.js',
   'for (let i = 0; i < 26; i++)', 'for (let i = 0; i < 20; i++)', 'test_terrain.js'],
  ['mirror: an octave dropped from the ridged mountains', 'js/terrain.js',
   'ridgedJ(wx * 0.0016, wz * 0.0016, 5)', 'ridgedJ(wx * 0.0016, wz * 0.0016, 4)', 'test_terrain.js'],
  ['shadow variant drifts from the body it approximates', 'js/shaders.js',
   'ridged(p * 0.0016, 2)) * mass * mix(0.42, 1.1, tall)',
   'ridged(p * 0.0016, 2)) * mass * mix(0.42, 1.3, tall)', 'test_terrain.js'],

  // --- alien hull states: the 6 Sept "game freezes" bug --------------------
  ['hullAlive forgets falling AND melting', 'js/aliens.js',
   'const hullAlive = o => !o.gone && !o.falling && !(o.melt > 0);',
   'const hullAlive = o => !o.gone;', 'test_aliens.js'],
  ['hullAlive forgets melting only', 'js/aliens.js',
   'const hullAlive = o => !o.gone && !o.falling && !(o.melt > 0);',
   'const hullAlive = o => !o.gone && !o.falling;', 'test_aliens.js'],

  // --- bomb-hit ring geometry ---------------------------------------------
  ['ring face always picks the length axis', 'js/aliens.js',
   'if (d > best) { best = d; ax = i; }', 'if (d > best && i === 0) { best = d; ax = i; }', 'test_aliens.js'],
  ['ring face chosen in metres, not half-extents', 'js/aliens.js',
   'const d = Math.abs(l[i]) / Math.max(half[i], 1e-6);', 'const d = Math.abs(l[i]);', 'test_aliens.js'],
  ['ring not clamped to the face it lies on', 'js/aliens.js',
   'Math.min(HULL_BLAST_R, Math.min(half[i1], half[i2]) * 0.92)', 'HULL_BLAST_R', 'test_aliens.js'],
  ['relay ring drawn flat instead of curved', 'js/aliens.js',
   'curv: R, maxR: Math.min(HULL_BLAST_R, R * 1.6)',
   'curv: 0, maxR: Math.min(HULL_BLAST_R, R * 1.6)', 'test_aliens.js'],

  // --- the invasion economy ------------------------------------------------
  ['blast cadence re-coupled to the size threshold', 'js/aliens.js',
   'if (r.shots >= RELAY_SHOTS) {', 'if (r.r >= r.baseR * RELAY_GROW) {', 'test_aliens.js'],
  ['the shot counter stops counting', 'js/aliens.js',
   'r.shots = (r.shots || 0) + 1;', 'r.shots = 1;', 'test_aliens.js'],
  ['collision ignores the corner fillet', 'js/aliens.js',
   'const r = Math.min(TUNEA.boxRound.v * Math.min(half[0], Math.min(half[1], half[2])),',
   'const r = Math.min(0.0 * Math.min(half[0], Math.min(half[1], half[2])),', 'test_aliens.js'],
  ['the relay snaps back instead of deflating', 'js/aliens.js',
   'r.shrinkT0 = now;', 'r.shrinkT0 = undefined; r.r = r.baseR;', 'test_aliens.js'],
  ['the melt tail is removed (wreck vanishes in 8 s again)', 'js/aliens.js',
   'const rate = (o.melt < MELT_KNEE) ? 1 / 8 : (1 - MELT_KNEE) / MELT_TAIL;',
   'const rate = 1 / 8;', 'test_aliens.js'],
  ['spent beams no longer pruned', 'js/aliens.js',
   'if (b.done && now - b.t0 > b.dur * 1.15) alien.bolts.splice(i, 1);',
   'if (false) alien.bolts.splice(i, 1);', 'test_aliens.js'],

  // --- what only the AST can see (needs npm install) -----------------------
  // A misspelled call is invisible to every regex in test_shader.js, compiles
  // to a driver error 80 s into a page load, and is exactly what the parser
  // reports as an undeclared function.
  ['a shader function call is misspelled', 'js/shaders.js',
   'cloudShadow(pos, sun)', 'cloudShadw(pos, sun)', 'test_glsl.js'],
  ['the uniform budget blows past its ceiling', 'js/shaders.js',
   'uniform vec4  uBolts[6];', 'uniform vec4  uBolts[60];', 'test_glsl.js'],

  // --- what only a real DOM can see (needs npm install) --------------------
  // Renaming an id in index.html leaves every module still valid JS. The
  // module that looks it up gets null and either throws on evaluation or
  // silently does nothing -- the same shape as the css `<style>` bug.
  ['an element id is renamed out from under the modules', 'index.html',
   'id="fx"', 'id="fx2"', 'test_smoke.js'],

  // The dev server bound IPv6-only on Windows and refused 127.0.0.1 -- the
  // address CLAUDE.md, the ROADMAP's Chrome command and Nico all use -- while
  // printing a perfectly healthy banner. Only a real socket can see it.
  ['serve.py goes back to binding IPv6-only (127.0.0.1 refused)', 'serve.py',
   'self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)',
   'pass', 'test_serve.js'],

  // The Debug master is the one control that WRITES to every other knob, and
  // its failure mode is silent data loss: you dial a setup in, press DEBUG,
  // and the setup is gone. Only a real DOM exercises it -- test_tune.js reads
  // the knob objects and never builds the panel.
  ['the master wipes a first-time setup (the v9.4 bug, restored)', 'js/debug.js',
   'if (t.v > 0.5) { if (o._user !== undefined) o.v = o._user; }',
   'if (t.v > 0.5) { o.v = o._user !== undefined ? o._user : o.d; }', 'test_panels.js'],
  ['touching a slider no longer arms the master', 'js/debug.js',
   "armMaster();   // or DEBUG would read 'off' while a setting was live", ';', 'test_panels.js'],
  ['the master moves the model but not the slider it sits under', 'js/debug.js',
   'paints.push(() => { slider.value = t.v; val.textContent = t.fmt(t.v); });',
   'paints.push(() => { val.textContent = t.fmt(t.v); });', 'test_panels.js'],
  ['two debug channels collide on one bitmask bit', 'js/debug.js',
   "colLOD:  { kind: 'toggle', bit: 32,", "colLOD:  { kind: 'toggle', bit: 2,", 'test_panels.js'],
  ['the panels leave the stacking column and can overlap again', 'index.html',
   '<div id="panels">', '<div id="panels"></div>', 'test_panels.js'],
  ['victory declared while the mothership still floats', 'js/hud.js',
   "classList.toggle('defeated', harv === 0 && relays === 0 && mothers === 0);",
   "classList.toggle('defeated', harv === 0);", 'test_panels.js'],

  // --- tuning + docs drift -------------------------------------------------
  ['a knob default drifts from its live value', 'js/tune.js',
   "shadows:    { label: 'shadows',     v: 1,", "shadows:    { label: 'shadows',     v: 0,", 'test_tune.js'],
  ['CLAUDE.md loses a module from the architecture map', 'CLAUDE.md',
   'aliens.js', 'ALIENS_GONE.js', 'test_docs.js', 'all'],

  // --- the chase camera's rest pose (Debug 'obs camera' = snap, 13 Sept) --
  // chasePose is an iteration; stop it early and the 'snap' camera parks a
  // few degrees off the springs' rest pose - a screenshot would still glide.
  ['chasePose stops short of the fixed point (12 rounds -> 1)', 'js/flight.js',
   'for (let i = 0; i < 12; i++) {', 'for (let i = 0; i < 1; i++) {', 'test_flight.js'],

  // --- the from-below crest straddle (13 Sept 2026, afternoon) -------------
  ['the step relaxation is hard-wired to 0.55 again (crest horns from below)', 'js/shaders.js',
   'float d = min(dT * relax, dP);', 'float d = min(dT * 0.55, dP);', 'test_shader.js'],

  // --- the march/terrain contract (13 Sept 2026) ---------------------------
  // A tuning slider must not be able to build a world the marcher cannot
  // render: at `peak height` 800 the island needs relax 0.22 and 7.3% of it
  // is unmarchable at the default. test_march.js is the only thing watching.
  // NB: anchored on the RANGE, not on v/d -- the battery reported this mutant
  // SKIPPED (anchor not found) the moment the default moved 0.55 -> 0.25 -> 0.30.
  // A mutant whose anchor drifts is a test that silently stopped running.
  ['the relaxation slider can no longer reach a safe step', 'js/debug.js',
   "min: 0.20, max: 0.55, step: 0.05", "min: 0.45, max: 0.55, step: 0.05", 'test_march.js'],

  // --- the debug split (14 Sept 2026) --------------------------------------
  // js/debug.js reaches the game through ONE dynamic import that build.js cuts.
  // Make it a STATIC import and it lands in the single-file artifact: the
  // double-click build would ship the Debug panel and, worse, the false-colour
  // channels, which are half the shader compile. test_build.js is the only
  // thing watching for that.
  ['js/debug.js sneaks into the artifact through a static import', 'js/main.js',
   "import { DEBUG_BUILD } from './dbgflag.js';",
   "import { DEBUG_BUILD } from './dbgflag.js';\nimport * as _dbg from './debug.js';", 'test_build.js'],

  // The game must not need the debug module to know its own settings.
  ['a DBG default drifts from the knob it mirrors', 'js/dbg.js',
   "relaxMtn:    0.3,", "relaxMtn:    0.55,", 'test_dbg.js'],

  // --- v9.8: the overlay's occlusion budget -------------------------------
  // The rings were drawn over mountains for two independent reasons, and each
  // of these mutants is one of them exactly as it shipped.
  ['ring slots go to the newest entries again, not the ones being drawn', 'js/fx.js',
   '  live.sort((a, b) => age(a) - age(b));',
   '  live.reverse();', 'test_fx.js'],
  ['a never-answered ring sorts last, so it is drawn blind', 'js/fx.js',
   '(p._vt === undefined ? -1e9 : p._vt)', '(p._vt === undefined ? 1e9 : p._vt)', 'test_fx.js'],
  ['the allocator and the draw loop disagree on ring lifetime', 'js/fx.js',
   'kind === 3 ? 0.9 : (kind === 4 ? 0.8 : 0.45)',
   'kind === 3 ? 0.9 : (kind === 4 ? 0.8 : 0.9)', 'test_fx.js'],
  ['the occlusion probe stride floor is a constant again (~480 m reach)', 'js/shaders.js',
   't += max(h * 0.7, floorStep);', 't += max(h * 0.7, 10.0);', 'test_shader.js'],
  ['the mothership stops hiding the overlay behind it', 'js/shaders.js',
   'if (g.x < g.y && g.x > 0.0 && g.x < L - 8.0) vis = 0.0;',
   'if (g.x < g.y && g.x < L - 8.0) vis = 0.0;', 'test_shader.js'],

  // --- v9.8: the fleet's shadow, and nightfall ----------------------------
  ['alienShadow starts marching the real hull (a second of compile per site)', 'js/shaders.js',
   '    vec2 g = boxGate(p - uMotherPos, sun, uMotherHalf);',
   '    float dd = shipDE(p - uMotherPos, uMotherHalf);\n    vec2 g = boxGate(p - uMotherPos, sun, uMotherHalf);', 'test_shader.js'],
  ['a melting wreck keeps casting its shadow', 'js/shaders.js',
   'if (uMotherPos.y > -9000.0 && uMotherMelt < 0.5) {',
   'if (uMotherPos.y > -9000.0) {', 'test_shader.js'],
  ['one alienShadow call site is quietly dropped', 'js/shaders.js',
   ' * cloudShadow(pos, sun) * alienShadow(pos, sun);',
   ' * cloudShadow(pos, sun);', 'test_shader.js'],
  ['nightAmount smoothstep edges inverted (undefined behaviour in GLSL)', 'js/shaders.js',
   'smoothstep(-0.26, 0.02, sun.y)', 'smoothstep(0.02, -0.26, sun.y)', 'test_shader.js'],
  // Re-anchored 16 Sept 2026: the floor moved -0.30 -> -0.72 for deepNight and
  // this mutant went SKIPPED, which is the only reason anyone noticed. The
  // mutated value must clear nightAmount's edge but fall short of deepNight's.
  ['the sun drag floor stops short of the night it enables', 'js/config.js',
   'export const SUN_EL_MIN = -0.72;', 'export const SUN_EL_MIN = -0.30;', 'test_shader.js'],

  // --- v9.9: the energy economy ------------------------------------------
  // One pool now funds the laser, so these are balance rules, not scores.
  // The canFireLaser one is here because it ESCAPED the first version of its
  // test: the sweep only sampled multiples of the cost, where `> 0` and
  // `>= 100` agree. The bug lives strictly between 0 and the cost.
  ['a refused spend still drains the pool', 'js/energy.js',
   'if (energy < n) return false;', 'if (energy < n) { energy -= n; render(); return false; }', 'test_energy.js'],
  ['the laser becomes free', 'js/energy.js',
   'export const LASER_COST = 100;', 'export const LASER_COST = 0;', 'test_energy.js'],
  ['a ring stops covering a shot', 'js/energy.js',
   'export const RING_ENERGY = 100;', 'export const RING_ENERGY = 40;', 'test_energy.js'],
  ['flora out-earns the ring course', 'js/energy.js',
   'export const SPORE_ENERGY = 1;', 'export const SPORE_ENERGY = 25;', 'test_energy.js'],
  ['canFireLaser disagrees with spendEnergy', 'js/energy.js',
   'return energy >= LASER_COST;', 'return energy > 0;', 'test_energy.js'],
  // single-line anchor on purpose: a multi-line one has to carry an escaped
  // newline through this file, and that is how this entry got written with a
  // RAW newline in a string literal and took the whole battery down.
  ['reset keeps whatever energy was left', 'js/energy.js',
   '  energy = START_ENERGY;', '  energy = energy;', 'test_energy.js'],

  // --- v9.9b: an invader hands back what it gathered -----------------------
  // The chain is trees -> harvester -> relay -> mothership, and each link
  // banks what the one below it spent. Every one of these is a link going
  // quietly to zero, which pays out nothing however long the invasion ran.
  ['the loot payout fires at the KILL instead of the melt', 'js/aliens.js',
   '    if (r.hp <= 0) r.falling = true;', '    if (r.hp <= 0) { payOutLoot(r); r.falling = true; }', 'test_aliens.js'],
  ['a melting hull pays out its loot every frame', 'js/aliens.js',
   '  o.loot = 0;', '  o.loot = o.loot;', 'test_aliens.js'],
  ['an empty hull still calls addEnergy', 'js/aliens.js',
   'if (!o.loot) return;', 'if (o.loot < 0) return;', 'test_aliens.js'],
  ['the relay banks nothing from an arrival', 'js/aliens.js',
   'r.loot = (r.loot || 0) + 3;', 'r.loot = (r.loot || 0) + 0;', 'test_aliens.js'],
  ['the mothership banks nothing from a discharge', 'js/aliens.js',
   'm.loot = (m.loot || 0) + RELAY_SHOTS * 3;', 'm.loot = (m.loot || 0) + 0;', 'test_aliens.js'],
  ['a harvester cannot count the trees it eats', 'js/aliens.js',
   'absorbed: 0, loot: 0,', 'absorbed: 0, loot: undefined,', 'test_aliens.js'],

  // --- v9.9c: collision follows the visible fractal ------------------------
  // The hull is a box INTERSECTED with a mandelbox, so parts of the box are
  // empty (3.9% of the mothership, 8.7% of a harvester -- hull_census.js).
  // Each of these either stops the carve happening or drifts the JS mirror
  // away from the GLSL, and both look fine until you fly into a hole.
  ['the fractal narrow phase is skipped, so holes are solid again', 'js/aliens.js',
   'return shipDEJ(lx, ly, lz, half) < (skin === undefined ? HULL_SKIN : skin);',
   'return true;', 'test_aliens.js'],
  ['the narrow phase inverts: solid becomes hollow', 'js/aliens.js',
   'return shipDEJ(lx, ly, lz, half) < (skin === undefined ? HULL_SKIN : skin);',
   'return shipDEJ(lx, ly, lz, half) > (skin === undefined ? HULL_SKIN : skin);', 'test_aliens.js'],
  ['the JS mandelbox mirror loses an iteration', 'js/aliens.js',
   'const MB_ITERS = 8;', 'const MB_ITERS = 7;', 'test_aliens.js'],
  ['the conservative stretch drifts from the shader', 'js/aliens.js',
   'const MB_STRETCH = 1.15;', 'const MB_STRETCH = 1.30;', 'test_aliens.js'],
  ['the mirror stops squaring boxMinR', 'js/aliens.js',
   'const minR2 = TUNEA.boxMinR.v * TUNEA.boxMinR.v;',
   'const minR2 = TUNEA.boxMinR.v;', 'test_aliens.js'],

  // --- v9.9c: the burst ring lands where the bomb actually stopped ---------
  // NB two of these carry trailing context on purpose: the cross product and
  // the normalise also appear verbatim in sphereFace, and an ambiguous anchor
  // is SKIPPED rather than run.
  ['the hull burst goes back to the bounding-box skin', 'js/aliens.js',
   '  if (!(len > 1e-4)) return boxFace(B, hull, half, rot);',
   '  return boxFace(B, hull, half, rot);', 'test_aliens.js'],
  ['the burst disc frame stops being orthonormal', 'js/aliens.js',
   `  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  // curv stays 0`,
   `  const vx = ny, vy = nz, vz = nx;
  // curv stays 0`, 'test_aliens.js'],
  ['the burst normal is left unnormalised', 'js/aliens.js',
   `  nx /= len; ny /= len; nz /= len;
  // sit just proud`, '  // sit just proud', 'test_aliens.js'],
  ['the hull burst is drawn as a bulb cap, not a flat disc', 'js/aliens.js',
   'n: [nx, ny, nz], curv: 0,', 'n: [nx, ny, nz], curv: 9,', 'test_aliens.js'],
];

function mutate(src, find, repl, all) {
  if (find === 'FBMLOD_MIX') {              // the first mix AFTER fbmLOD starts
    const i = src.indexOf('float fbmLOD');
    const old = 'mix(NOISE_MEAN, noise(p), w)';
    const j = src.indexOf(old, i);
    if (i < 0 || j < 0) throw new Error('fbmLOD mix anchor not found');
    return src.slice(0, j) + repl + src.slice(j + old.length);
  }
  if (!src.includes(find)) throw new Error('anchor not found: ' + find.slice(0, 60));
  return all ? src.split(find).join(repl) : src.replace(find, repl);
}

// Refuse to run over uncommitted work in the files we are about to rewrite.
const targets = [...new Set(MUTANTS.map(m => m[1]))];
let dirty = '';
try {
  dirty = execFileSync('git', ['status', '--porcelain', '--', ...targets],
                       { cwd: ROOT, encoding: 'utf8' }).trim();
} catch { /* no git: fall through, the finally-restore still protects us */ }
if (dirty) {
  console.error('refusing to run: these files have uncommitted changes, and a crash\n' +
                'mid-mutation would be indistinguishable from your own edits:\n' + dirty);
  process.exit(2);
}

const originals = new Map(targets.map(f => [f, read(f)]));
const restoreAll = () => { for (const [f, s] of originals) { try { write(f, s); } catch {} } };
process.on('SIGINT', () => { restoreAll(); process.exit(130); });
// Any crash mid-run must put the sources back before the process dies.
process.on('uncaughtException', e => {
  try { restoreAll(); } catch (e2) { console.error('RESTORE FAILED — check `git status`:', e2.message); }
  console.error('mutation battery crashed:', e && e.stack || e);
  process.exit(2);
});

console.log('mutation battery — every row must go RED\n');
console.log('%s %s', 'MUTANT'.padEnd(58), 'RESULT');
console.log('-'.repeat(76));

const escaped = [];
let ran = 0;
for (const [label, file, find, repl, test, all] of MUTANTS) {
  const orig = originals.get(file);
  let next;
  try {
    next = mutate(orig, find, repl, all === 'all');   // compute BEFORE writing
  } catch (e) {
    console.log('%s %s', label.slice(0, 57).padEnd(58), 'SKIPPED — ' + e.message);
    continue;
  }
  if (next === orig) {
    console.log('%s %s', label.slice(0, 57).padEnd(58), 'SKIPPED — mutation was a no-op');
    continue;
  }
  let caught;
  try {
    write(file, next);
    caught = spawnSync(process.execPath, [path.join(__dirname, test)],
                       { cwd: ROOT }).status !== 0;
  } finally {
    write(file, orig);
  }
  ran++;
  console.log('%s %s', label.slice(0, 57).padEnd(58), caught ? 'RED — caught' : '*** GREEN — ESCAPED ***');
  if (!caught) escaped.push(label + '   (' + test + ')');
}

restoreAll();
console.log('-'.repeat(76));
console.log('%d/%d mutants caught', ran - escaped.length, ran);
for (const e of escaped) console.log('  ESCAPED: ' + e);
if (escaped.length) {
  console.log('\nAn escaped mutant means that assertion does not test what it says.\n' +
              'Fix the TEST, not the mutant.');
}
process.exit(escaped.length ? 1 : 0);
