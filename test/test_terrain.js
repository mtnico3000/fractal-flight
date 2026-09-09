// The CPU terrain mirror vs the GLSL it mirrors.
//
// js/terrain.js is a hand-written fp64 port of terrainShape(). Ring placement,
// alien placement and the camera clamp all answer with it, and CLAUDE.md is
// blunt about the trap: "don't move MB_CENTER/MB_SCALE without updating BOTH
// shader constants and terrain.js literals". Nothing checked that until now --
// the mirror was the only module in the collision path with no test at all.
//
// Drift here is silent. The GPU probe row keeps rendering and colliding
// correctly because it runs the real GLSL; only the JS-side answers move, so
// rings spawn in the sea, aliens sit inside hills, and the camera clamps to a
// ground height that is not there. Nothing throws.
//
// Three angles, because no single one catches everything:
//
//   1. GOLDEN VALUES pin the mirror's own arithmetic. TUNE is stubbed with
//      fixed numbers rather than read from tune.js, so retuning the world --
//      which happens often -- cannot false-red this file. It tests the
//      function, not the current taste.
//   2. SHARED CONSTANTS are compared numerically against the shader source,
//      not textually: the GLSL says `1.0e-4` where the mirror says `1e-4`.
//   3. DERIVED CONSTANTS are the real drift risk. The shader writes
//      `smoothstep(0.58, 0.72, v)` where the mirror writes `(v - 0.58) / 0.14`
//      -- the second edge exists in the mirror only as a span. Change 0.72 in
//      the shader and no textual check anywhere would notice; asserting
//      0.58 + 0.14 === 0.72 does.

const fs = require('fs');
const path = require('path');
const { loadModule, check, eq, ok, summary } = require('./harness');

const root = path.join(__dirname, '..');
const glsl = fs.readFileSync(path.join(root, 'js', 'shaders.js'), 'utf8').replace(/\r\n/g, '\n');
const mirror = fs.readFileSync(path.join(root, 'js', 'terrain.js'), 'utf8').replace(/\r\n/g, '\n');

// The knob values the goldens below were measured under. Deliberately literal:
// if these tracked tune.js, every retune would look like a mirror regression.
const PINNED = { oceanSlope: 0.016, oceanMax: 107, massDecay: 0.0011, mountAmp: 460, snowyPct: 10 };
const stubTune = (over = {}) => {
  const TUNE = {};
  for (const [k, v] of Object.entries({ ...PINNED, ...over })) TUNE[k] = { v };
  return TUNE;
};
const load = (over) => loadModule('terrain.js', { TUNE: stubTune(over) });

// every number in a string, with the sign attached; whitespace stripped first
// so `px * 2.5e-4 - 0.55` yields -0.55 rather than 0.55.
const numsIn = s => (s.replace(/\s+/g, '').match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number);
const has = (s, n) => numsIn(s).some(x => x === n);

function glslConst(name) {
  const m = new RegExp('const\\s+\\w+\\s+' + name + '\\s*=\\s*([^;]+);').exec(glsl);
  ok(m, name + ' not found in shaders.js');
  return numsIn(m[1].replace(/vec[234]/g, ''));   // or the N in vecN parses as a number
}
// Bound a GLSL function to its own body. Without this the checks below run
// over the whole shader, and terrainCheapH() -- a THIRD copy of the shaping
// maths, for shadow rays -- silently answers for terrainShapeLOD(): moving
// `mix(0.42, 1.1, tall)` in the main body left the file green because the
// cheap variant still held the old pair. Verified red 9 Sept 2026.
function glslBody(name) {
  const i = glsl.indexOf('float ' + name + '(');
  ok(i >= 0, name + '() not found in shaders.js');
  const end = glsl.indexOf('\n}', i);      // no brace sits at column 0 inside these
  ok(end > i, name + '(): could not find the end of the body');
  return glsl.slice(i, end);
}
const shapeBody = glslBody('terrainShapeLOD');
const cheapBody = glslBody('terrainCheapH');

function mirrorLine(re, what) {
  const m = re.exec(mirror);
  ok(m, 'terrain.js: could not find ' + what);
  return m[0];
}

console.log('terrain');

// --- 1. the mirror's own arithmetic ----------------------------------------

// Measured 9 Sept 2026 from the shipped mirror under PINNED. Land, alpine,
// the second (continent) fractal, and open ocean, so a change to any one of
// worldDE / mass / base / mountain / lake moves at least one row.
const GOLDEN = [
  [0, 0, 48.658525],
  [1200, -800, 45.816129],
  [-2600, 1500, 86.898131],
  [500, 14000, 246.117397],
  [9000, 9000, 313.814423],
  [-15000, -15000, -50.915213],
  [300, -2200, 78.466644],
  [4200, 600, 109.303378],
];

check('terrainShapeJ reproduces its measured heights', () => {
  const { terrainShapeJ } = load();
  for (const [x, z, want] of GOLDEN) {
    const got = terrainShapeJ(x, z);
    ok(Math.abs(got - want) < 1e-4,
       'terrainShapeJ(' + x + ', ' + z + '): expected ' + want + ', got ' + got.toFixed(6));
  }
});

check('the mirror is deterministic and finite', () => {
  const { terrainShapeJ } = load();
  for (const [x, z] of GOLDEN) {
    const a = terrainShapeJ(x, z);
    ok(Number.isFinite(a), 'terrainShapeJ(' + x + ', ' + z + ') must be finite, got ' + a);
    eq(terrainShapeJ(x, z), a, 'same input must give the same height');
  }
});

check('the mirror reads the live TUNE, so a tuned world collides correctly', () => {
  const flat = load({ mountAmp: 100 }).terrainShapeJ(9000, 9000);
  const tall = load({ mountAmp: 800 }).terrainShapeJ(9000, 9000);
  ok(tall > flat + 50, 'peak height should move the mountains: ' + flat.toFixed(1) + ' -> ' + tall.toFixed(1));
  const shallow = load({ oceanMax: 20 }).terrainShapeJ(-15000, -15000);
  const deep = load({ oceanMax: 140 }).terrainShapeJ(-15000, -15000);
  ok(deep < shallow, 'ocean depth should deepen open water: ' + shallow.toFixed(1) + ' -> ' + deep.toFixed(1));
});

// --- 2. constants shared with the GLSL --------------------------------------

check('both Mandelbrot placements match the shader constants', () => {
  const scale = glslConst('MB_SCALE')[0];
  const center = glslConst('MB_CENTER');
  const w1 = mirrorLine(/const w1 = mandelDEJ\([^;]+;/, 'the w1 (home island) line');
  ok(has(w1, scale), 'w1 must use MB_SCALE ' + scale + ', line reads: ' + w1.trim());
  ok(has(w1, center[0]), 'w1 must use MB_CENTER.x ' + center[0] + ', line reads: ' + w1.trim());

  const scale2 = glslConst('MB2_SCALE')[0];
  const center2 = glslConst('MB2_CENTER');
  const offset2 = glslConst('MB2_OFFSET');
  const w2 = mirrorLine(/const w2 = mandelDEJ\([^;]+;/, 'the w2 (continent) line');
  ok(has(w2, scale2), 'w2 must use MB2_SCALE ' + scale2 + ', line reads: ' + w2.trim());
  ok(has(w2, center2[0]), 'w2 must use MB2_CENTER.x ' + center2[0] + ', line reads: ' + w2.trim());
  // the mirror subtracts the offset inline: (pz - 14000)
  ok(has(w2, -offset2[1]), 'w2 must offset by MB2_OFFSET.y ' + offset2[1] + ', line reads: ' + w2.trim());
});

check('the escape-iteration count matches', () => {
  const g = /float mandelDE\([^)]*\)[\s\S]{0,400}?for \(int i = 0; i < (\w+|\d+)/.exec(glsl);
  const wde = /worldDE\(p, (\d+)\)/.exec(glsl);
  ok(wde, 'could not find the worldDE iteration count in shaders.js');
  const m = /for \(let i = 0; i < (\d+); i\+\+\)/.exec(mirror.slice(mirror.indexOf('function mandelDEJ')));
  ok(m, 'could not find the mandelDEJ loop bound in terrain.js');
  eq(Number(m[1]), Number(wde[1]),
     'mandelDEJ iterations vs worldDE(p, N) -- fewer iterations moves coastlines' + (g ? '' : ''));
});

// --- 3. constants the mirror stores in a DERIVED form ------------------------

// smoothstep(lo, hi, x) in the shader becomes clamp((x - lo) / span) in the
// mirror, so `hi` survives only as `span`. Each row asserts lo + span === hi:
// change one edge in the shader and the pair stops reconstructing.
check('smoothstep edges reconstruct from the mirror spans', () => {
  const rows = [
    ['lake valley', /smoothstep\(([\d.]+), ([\d.]+), valley\)/, /\(val - ([\d.]+)\) \/ ([\d.]+)/],
    ['lake mass', /smoothstep\((0\.4), (0\.9), mass\)/, /\(mass - ([\d.]+)\) \/ ([\d.]+)/],
    ['lake peak cut', /smoothstep\((30\.0), (80\.0), mountain\)/, /\(m - ([\d.]+)\) \/ ([\d.]+)/],
  ];
  for (const [what, gRe, mRe] of rows) {
    const g = gRe.exec(shapeBody), m = mRe.exec(mirror);
    ok(g, what + ': shader edges not found');
    ok(m, what + ': mirror form not found');
    const lo = Number(g[1]), hi = Number(g[2]);
    const mLo = Number(m[1]), span = Number(m[2]);
    eq(mLo, lo, what + ': low edge');
    ok(Math.abs(mLo + span - hi) < 1e-9,
       what + ': mirror span ' + span + ' should reach the shader high edge ' + hi +
       ' (got ' + (mLo + span) + ')');
  }
});

check('the tall-range amplitude mix reconstructs', () => {
  // shader: ampScale = mix(0.42, 1.1, tall)   mirror: (0.42 + 0.68 * tt)
  const g = /mix\((0\.42), (1\.1), tall\)/.exec(shapeBody);
  ok(g, 'ampScale mix not found in shaders.js');
  const m = /\((0\.42) \+ ([\d.]+) \* tt\)/.exec(mirror);
  ok(m, 'the ampScale form not found in terrain.js');
  ok(Math.abs(Number(m[1]) + Number(m[2]) - Number(g[2])) < 1e-9,
     'mirror ' + m[1] + ' + ' + m[2] + ' should equal the shader top ' + g[2]);
});

check('the snow-line quantile fit is the same three numbers', () => {
  const g = /17\.3 \/ \(uSnowFrac \+ 6\.44\) - 2\.32/.test(shapeBody);
  const m = /17\.3 \/ \(TUNE\.snowyPct\.v \/ 100 \+ 6\.44\) - 2\.32/.test(mirror);
  ok(g, 'shaders.js: the tallTh quantile fit changed shape');
  ok(m, 'terrain.js: the tallTh quantile fit does not match the shader');
});

// Literals that appear verbatim on both sides. Only the ones the mirror really
// does store directly -- the derived ones are handled above, and listing them
// here would produce a false red instead of a real one.
check('the directly-shared literals still agree', () => {
  const body = mirror.slice(mirror.indexOf('export function terrainShapeJ'));
  const shared = [
    [0.0004, 'base elevation frequency'],
    [70, 'base elevation amplitude'],
    [0.0009, 'domain-warp frequency'],
    [60, 'domain-warp strength'],
    [0.00018, 'range-selector frequency'],
    [0.0016, 'ridged mountain frequency'],
    [460, 'tanh summit saturation'],
    [45, 'smax blend width'],
    [0.0003, 'lake valley frequency'],
    [200, 'lake valley offset'],
    [0.65, 'lake depth blend'],
  ];
  const nums = numsIn(body);
  for (const [n, what] of shared) {
    ok(nums.includes(n), 'terrain.js no longer uses ' + n + ' (' + what + ')');
    ok(numsIn(glsl).includes(n), 'shaders.js no longer uses ' + n + ' (' + what + ')');
  }
});

check('the mirror still uses the same octave counts', () => {
  const body = mirror.slice(mirror.indexOf('export function terrainShapeJ'));
  eq((body.match(/fbmJ\([^)]*, 3\)/g) || []).length, 4, 'three-octave fbm calls');
  ok(/fbmJ\([^)]*, 2\)/.test(body), 'the range selector is a 2-octave fbm');
  ok(/ridgedJ\([^)]*, 5\)/.test(body), 'the mountain term is 5 ridged octaves');
});

// terrainCheapH() is the shadow-ray approximation. It is DELIBERATELY coarser
// -- 13 escape iterations instead of 26, 2 octaves instead of 3/5, no domain
// warp, no lakes -- but the constants that place and scale the mountains have
// to track terrainShapeLOD, or shadows are cast by a different mountain than
// the one being drawn. Found while writing this file: nothing guarded it.
check('the shadow-ray variant shares the shaping constants', () => {
  const shared = [
    [/17\.3 \/ \(uSnowFrac \+ 6\.44\) - 2\.32/, 'the snow-line quantile fit'],
    [/mix\(0\.42, 1\.1, tall\)/, 'the tall-range amplitude mix'],
    [/460\.0 \* tanh\(mountain \/ 460\.0\)/, 'the tanh summit saturation'],
    [/80\.0 \+ uMountAmp/, 'the mountain base amplitude'],
    [/70\.0 \* \(1\.0 - mass\)/, 'the open-ocean sink'],
    [/\* 70\.0 \+ 4\.0 - clamp\(wde \* uOceanSlope, 0\.0, uOceanMax\)/, 'the base elevation term'],
    [/smax\(base(Elev)?, mountain, 45\.0\)/, 'the smax blend width'],
  ];
  for (const [re, what] of shared) {
    ok(re.test(shapeBody), 'terrainShapeLOD no longer matches ' + what);
    ok(re.test(cheapBody), 'terrainCheapH has drifted from terrainShapeLOD on ' + what);
  }
});

process.exitCode = summary('terrain') ? 1 : 0;
