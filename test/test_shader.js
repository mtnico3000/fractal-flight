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

// The fade must decay toward each octave's measured mean. Toward zero it also
// lowers the average height, so distant ground sinks as you fly at it -- a
// systematic sub-pixel shift across a whole silhouette, which reads as the
// terrain breathing rather than as detail arriving.
check('faded octaves decay toward the octave mean, not toward zero', () => {
  ok(/NOISE_MEAN\s*=\s*0\.49/.test(glsl), 'NOISE_MEAN should be the measured E[noise()]');
  ok(/RIDGE_MEAN\s*=\s*0\.44/.test(glsl), 'RIDGE_MEAN should be the measured E[ridged octave term]');
  for (const fn of ['fbmLOD', 'fbmRLOD', 'ridgedLOD']) {
    const body = glsl.slice(glsl.indexOf('float ' + fn));
    ok(/mix\(\s*(NOISE|RIDGE)_MEAN/.test(body.slice(0, 700)), fn + ' must fade toward the mean');
  }
});

// A backtick inside the GLSL closes the JS template literal early and turns
// the rest of the shader into stray JS tokens. It cost a debugging round on
// 6 Sept 2026; build.js parses the bundle now, but naming it here says why.
check('no backtick inside the GLSL templates', () => {
  const ticks = (src.match(/`/g) || []).length;
  ok(ticks === 4, 'expected exactly 4 backticks (two template delimiters), found ' + ticks +
                  ' -- a stray one ends the shader string early');
});

process.exitCode = summary('shader') ? 1 : 0;
