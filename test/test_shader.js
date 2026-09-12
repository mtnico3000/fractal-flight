// Shader-source invariants that cannot be checked any other way yet.
//
// The GLSL is a template string, so Node can read it but not run it (running
// it is ROADMAP C2's glsl-parser item). These are the few properties whose
// violation is silent, expensive, and has already happened once.

const fs = require('fs');
const path = require('path');
const { check, ok, summary } = require('./harness');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'shaders.js'), 'utf8');
const glsl = src.slice(src.indexOf('export const fsSrc'));

console.log('shader');

// A1 made the terrain footprint-aware. terrainShape() stayed behind as the
// full-detail entry point because the GPU probe row and the terrain.js mirror
// both answer collision queries with it. Point it at the marching footprint
// and the world you hit stops being the world you see -- silently, and only
// at distance, which is the worst way to find out.
check('terrainShape() is still the full-detail (px = 0) wrapper', () => {
  ok(/float\s+terrainShape\s*\(\s*vec2\s+p\s*\)\s*\{\s*return\s+terrainShapeLOD\s*\(\s*p\s*,\s*0\.0\s*\)\s*;\s*\}/.test(glsl),
     'terrainShape must be exactly `return terrainShapeLOD(p, 0.0);` -- it is the collision authority');
});

check('the collision probe row answers with terrainShape, never the LOD variant', () => {
  // anchored on the row test itself: the words "collision probe" also appear
  // in a plantEval comment 600 lines earlier, which silently widened this
  // slice to most of the shader the first time it was written
  const start = glsl.indexOf('gl_FragCoord.y < 1.0');
  const end = glsl.indexOf('vec2 uv = (2.0 *', start);
  ok(start > 0 && end > start, 'could not locate the probe-row block');
  const probe = glsl.slice(start, end);
  ok(!/terrainShapeLOD/.test(probe),
     'the probe row must stay full detail, or collision drifts from the CPU mirror');
  ok(/terrainShape\(/.test(probe), 'the probe row should call terrainShape');
});

// Slice a shader function to its OWN body, bounded by the next top-level
// declaration. This used to be a fixed 700-char window, which reached past
// the end of the function: fbmLOD's window covered all of fbmLOD AND most of
// fbmRLOD, so breaking fbmLOD's fade was still answered green by the
// neighbour's mix(). Verified 9 Sept 2026 -- fading fbmLOD toward 0.0, the
// exact bug the check below names, passed all four assertions.
function bodyOf(name) {
  const i = glsl.indexOf('float ' + name + '(');
  ok(i >= 0, 'shader function ' + name + '() not found');
  const next = glsl.indexOf('\nfloat ', i + 1);
  return glsl.slice(i, next < 0 ? glsl.length : next);
}

// The fade must decay toward each octave's measured mean. Toward zero it also
// lowers the average height, so distant ground sinks as you fly at it -- a
// systematic sub-pixel shift across a whole silhouette, which reads as the
// terrain breathing rather than as detail arriving.
check('faded octaves decay toward the octave mean, not toward zero', () => {
  ok(/NOISE_MEAN\s*=\s*0\.49/.test(glsl), 'NOISE_MEAN should be the measured E[noise()]');
  ok(/RIDGE_MEAN\s*=\s*0\.44/.test(glsl), 'RIDGE_MEAN should be the measured E[ridged octave term]');
  for (const fn of ['fbmLOD', 'fbmRLOD', 'ridgedLOD']) {
    ok(/mix\(\s*(NOISE|RIDGE)_MEAN/.test(bodyOf(fn)), fn + ' must fade toward the mean');
  }
});

// A backtick inside the GLSL closes the JS template literal early and turns
// the rest of the shader into stray JS tokens. It cost a debugging round on
// 6 Sept 2026; build.js parses the bundle now, but naming it here says why.
// MELT_KNEE lives in BOTH aliens.js (which drives the melt) and shaders.js
// (which decides how it is coloured). Drift means the pulse would stop at a
// different point than the melt slows down -- a wreck that goes quiet while
// still visibly collapsing, or blinks for two minutes. Numeric, not textual.
check('the melt knee agrees between aliens.js and the shader', () => {
  const aliens = fs.readFileSync(path.join(__dirname, '..', 'js', 'aliens.js'), 'utf8');
  const js = /const MELT_KNEE = ([\d.]+);/.exec(aliens);
  const gl = /const float MELT_KNEE = ([\d.]+);/.exec(glsl);
  ok(js, 'MELT_KNEE not found in aliens.js');
  ok(gl, 'MELT_KNEE not found in the shader');
  ok(Number(js[1]) === Number(gl[1]),
     'aliens.js says ' + js[1] + ', the shader says ' + gl[1] +
     ' -- the pulse would stop at a different melt than the collapse does');
});

check('sharp hull corners stay bit-identical', () => {
  // uBoxRound = 0 must reduce to the v9.3 expression exactly, or every ship
  // silently changes shape for anyone who never touches the slider.
  ok(/float r = min\(uBoxRound \* hmin, hmin \* 0\.98\);/.test(glsl),
     'the fillet radius should be clamped to the smallest half-extent');
  ok(/return max\(sdBox\(l, h - r\) - r, mb\);/.test(glsl),
     'the rounded box must be sdBox(l, h - r) - r, which is exact at r = 0');
});

// The hull marches need a large iteration ceiling and NO step relaxation --
// both counter-intuitive, both measured (see the comment in marchAliens). A
// tangent ray that runs out of budget returns a miss, and the hull vanishes in
// thin slivers that read as horns along a rounded edge.
// v9.5. Four things in marchTerrain, each measured on the fp64 mirror before it
// shipped (RESEARCH.md s6): 150 iterations was exhausted by 49 of 16 500 rays
// over a beach at 3 degrees, and exhaustion returned -1 -- which the material
// pass turned into WATER wherever the ray had crossed the water plane, i.e. a
// spike of sea into the sand that came and went with the camera. The constant
// 0.0018*t minimum stride stepped over beach berms and landed up to 45 m
// further along; the secant refine takes the stop residual from 1.2 m to
// 0.05 m at 4 km. Together they took frame-to-frame land/water/sky flips over
// the beach from 15 to 4 -- the reference marcher's own parallax count.
check('the terrain march: budget is a hit, not a hole; refine only while closing', () => {
  const i = glsl.indexOf('vec2 marchTerrain(');
  ok(i >= 0, 'marchTerrain() not found');
  const body = glsl.slice(i, glsl.indexOf('\n}', i));
  const loop = /for \(int i = 0; i < (\d+); i\+\+\)/.exec(body);
  ok(loop && Number(loop[1]) >= 384, 'terrain march is down to ' + (loop && loop[1]) +
     ' iterations; 150 was exhausted by grazing beach rays');
  ok(/return vec2\(t, \(dP < dT\) \? 4\.0 : 1\.0\);\s*$/.test(body),
     'a ray that exhausts the budget must return the surface it was crawling along, ' +
     'not -1 -- that -1 became WATER over the beach');
  ok(/pdT > dT && pdT < 1e4 && uHitRefine > 0\.5/.test(body),
     'the hit refine may only extrapolate while the gap is still SHRINKING; a ' +
     'growing gap is a ray cresting a bump and extrapolating hands it to the far side');
  ok(/t \+= d \+ t \* uMarchStride;/.test(body),
     'the minimum stride must be the uMarchStride uniform (0.0009), not the old 0.0018 constant');
});

check('the hull marches keep their tangency budget', () => {
  const mm = /for \(int i = 0; i < (\d+); i\+\+\)[\s\S]{0,60}?float d = shipDE\(lo \+ rd \* t, uMotherHalf\);/.exec(glsl);
  const hm = /for \(int i = 0; i < (\d+); i\+\+\)[\s\S]{0,60}?float d = shipDE\(lo \+ ld \* t, uShipHalf\);/.exec(glsl);
  ok(mm, 'could not find the mothership march loop');
  ok(hm, 'could not find the harvester march loop');
  ok(Number(mm[1]) >= 384, 'mothership march is down to ' + mm[1] +
     ' iterations; below ~384 tangent rays start missing the hull');
  ok(Number(hm[1]) >= 384, 'harvester march is down to ' + hm[1] + ' iterations');
  // relaxation measured WORSE here; the steps must stay full length
  ok(/float d = shipDE\(lo \+ rd \* t, uMotherHalf\);[\s\S]{0,200}?t \+= d;/.test(glsl),
     'the mothership march must step t += d, not a relaxed fraction');
});

check('no backtick inside the GLSL templates', () => {
  const ticks = (src.match(/`/g) || []).length;
  ok(ticks === 4, 'expected exactly 4 backticks (two template delimiters), found ' + ticks +
                  ' -- a stray one ends the shader string early');
});

process.exitCode = summary('shader') ? 1 : 0;
