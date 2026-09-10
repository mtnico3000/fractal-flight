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
const write = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

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
  ['relay growth increment hard-coded again', 'js/aliens.js',
   'r.r += r.baseR * (RELAY_GROW - 1) / RELAY_STEPS;', 'r.r += r.baseR * 0.02;', 'test_aliens.js'],
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

  // --- tuning + docs drift -------------------------------------------------
  ['a knob default drifts from its live value', 'js/tune.js',
   "shadows:    { label: 'shadows',     v: 1,", "shadows:    { label: 'shadows',     v: 0,", 'test_tune.js'],
  ['CLAUDE.md loses a module from the architecture map', 'CLAUDE.md',
   'aliens.js', 'ALIENS_GONE.js', 'test_docs.js', 'all'],
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
