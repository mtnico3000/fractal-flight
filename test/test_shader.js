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
     'the minimum stride must be the uMarchStride uniform, not a constant');
  // 13 Sept 2026: with the stride floor at 0.0002 the last step before a stop
  // is short, and a refine bounded to TWO of it could not reach the crossing
  // on a shallow beach -- residual 0.05 -> 0.34 m at 4 km, silently. tolRay is
  // exactly the along-ray distance a within-tolerance gap can still need.
  ok(/t \+ max\(2\.0 \* \(t - pt\), tolRay\)\)/.test(body),
     'the refine extrapolation must be bounded by max(two strides, tolRay), not two strides alone');
  // 13 Sept 2026, afternoon: the safe step on a heightfield marched by its
  // vertical gap is gap * cos(slope), so 0.55 covers only 56.6 deg. From
  // below a ridge the sample lands past the thin crest, and its top came and went with the
  // camera -- 30 px of horns on Nico's ALT 127 series. The relaxation must be
  // the mountain-keyed uniform, and the terrain crossing must then be
  // interpolated from the GAPS, because the step is no longer 0.55 x gap.
  ok(/float relax = mix\(0\.55, uRelaxMtn, smoothstep\(0\.25, 0\.60, mass\)\);/.test(body),
     'the step relaxation must be mix(0.55, uRelaxMtn, smoothstep(0.25, 0.60, mass))');
  ok(/float d = min\(dT \* relax, dP\);/.test(body),
     'the terrain step must use the keyed relaxation, not a constant');
  ok(/clamp\(pdT \/ \(pdT - dT\), 0\.0, 1\.0\)/.test(body),
     'the terrain crossing must be interpolated from the last two gaps (pdT, dT)');
});

check('the hull marches keep their tangency budget', () => {
  const mm = /for \(int i = 0; i < (\d+); i\+\+\)[\s\S]{0,60}?float d = shipDE\(lo \+ rd \* t, uMotherHalf, mMinR2\);/.exec(glsl);
  const hm = /for \(int i = 0; i < (\d+); i\+\+\)[\s\S]{0,60}?float d = shipDE\(lo \+ ld \* t, uShipHalf, sMinR2\);/.exec(glsl);
  ok(mm, 'could not find the mothership march loop');
  ok(hm, 'could not find the harvester march loop');
  ok(Number(mm[1]) >= 384, 'mothership march is down to ' + mm[1] +
     ' iterations; below ~384 tangent rays start missing the hull');
  ok(Number(hm[1]) >= 384, 'harvester march is down to ' + hm[1] + ' iterations');
  // relaxation measured WORSE here; the steps must stay full length
  ok(/float d = shipDE\(lo \+ rd \* t, uMotherHalf, mMinR2\);[\s\S]{0,200}?t \+= d;/.test(glsl),
     'the mothership march must step t += d, not a relaxed fraction');
});

check('the fx occlusion probe can reach the particle it is asked about', () => {
  // The probe answers "is this overlay dot behind a mountain?" by marching
  // terrainShape from the camera to the dot. Its stride floor was a CONSTANT
  // 10 m against a 48-iteration cap, so the march died after ~480 m and every
  // particle past that answered "visible" whatever stood in front of it --
  // which is most of why harvest rings were drawn over ridges. The floor has
  // to scale with the segment so the cap always spans it.
  const probe = /vec3 pt = uFxPos\[px - 85\];[\s\S]*?fragColor = vec4\(vis, vis, vis, 1\.0\);/.exec(glsl);
  ok(probe, 'could not find the fx occlusion probe branch');
  const body = probe[0];
  ok(/float floorStep = L \/ [\d.]+;/.test(body),
     'the probe stride floor must be derived from the segment length L, not a constant');
  ok(/t \+= max\(h \* 0\.7, floorStep\);/.test(body),
     'the probe march must step with the derived floor');
  const cap = /for \(int i = 0; i < (\d+); i\+\+\)/.exec(body);
  const div = /float floorStep = L \/ ([\d.]+);/.exec(body);
  ok(cap && div && Number(div[1]) <= Number(cap[1]),
     'the floor divisor (' + (div && div[1]) + ') must not exceed the iteration cap (' +
     (cap && cap[1]) + '), or the march still cannot span the segment');
});

check('the mothership hides the overlay and the harvesters deliberately do not', () => {
  const probe = /vec3 pt = uFxPos\[px - 85\];[\s\S]*?fragColor = vec4\(vis, vis, vis, 1\.0\);/.exec(glsl);
  ok(probe, 'could not find the fx occlusion probe branch');
  const body = probe[0];
  ok(/boxGate\(uCamPos - uMotherPos, dv \/ max\(L, 1e-4\), uMotherHalf\)/.test(body),
     'the probe must gate the overlay against the mothership bounding box');
  // the harvest sweep is the thing you are meant to watch THROUGH a harvester
  ok(!/uShipPos|uShipHalf|uRelay\b/.test(body),
     'harvesters and the relay must NOT occlude the overlay -- the harvest pops under a hull are the feedback');
  // g.x > 0 keeps the camera-inside-the-box case from blacking the overlay out
  ok(/g\.x < g\.y && g\.x > 0\.0 && g\.x < L - [\d.]+/.test(body),
     'the mothership gate needs all three guards: hit, entry ahead of the camera, and particle beyond the entry');
});

check('the alien fleet casts a shadow, without marching its hull', () => {
  ok(/float alienShadow\(vec3 p, vec3 sun\)/.test(glsl), 'alienShadow must exist');
  const fn = /float alienShadow\(vec3 p, vec3 sun\) \{[\s\S]*?\n\}/.exec(glsl);
  ok(fn, 'could not isolate alienShadow');
  const body = fn[0];
  // GLSL inlines every call site; shipDE carries a mandelbox loop, and this
  // function is called from three shading paths. A march here would cost what
  // the two debug channels cost (30.7% of the inlined program, docs/COMPILE.md).
  ok(!/shipDE|mandelbox|mandelbulbDE/.test(body),
     'alienShadow must stay analytic -- no hull SDF, or it costs a second of compile per call site');
  ok(/uMotherPos/.test(body) && /uShipPos\[i\]/.test(body) && /uRelay/.test(body),
     'all three hull kinds must block the sun');
  // a downed hull is inert everywhere else; its shadow must die with it
  ok(/uMotherMelt < 0\.5/.test(body) && /uShipMelt\[i\] > 0\.5/.test(body) && /uRelayMelt < 0\.5/.test(body),
     'a melting wreck must stop casting a shadow');
  ok(/if \(uShadows < 0\.5\) return 1\.0;/.test(body), 'alienShadow must honour the shadow-pack toggle');
  for (const mat of ['terrain', 'water', 'plant']) void mat;
  const calls = (glsl.match(/alienShadow\(pos, sun\)/g) || []).length;
  ok(calls === 3, 'expected alienShadow at the terrain, water and plant call sites, found ' + calls);
});

check('nightfall continues where dusk saturates', () => {
  // duskAmount is already 1 when the sun touches the horizon, so it cannot
  // describe anything below it. Both must exist, and the sun-drag floor in
  // config.js has to actually reach the point where night saturates.
  ok(/float nightAmount\(vec3 sun\) \{ return 1\.0 - smoothstep\(([-\d.]+), ([-\d.]+), sun\.y\); \}/.test(glsl),
     'nightAmount must be a smoothstep on sun.y with edge0 < edge1 (GLSL is undefined otherwise)');
  const m = /float nightAmount\(vec3 sun\) \{ return 1\.0 - smoothstep\(([-\d.]+), ([-\d.]+), sun\.y\); \}/.exec(glsl);
  ok(Number(m[1]) < Number(m[2]), 'smoothstep edges are inverted: ' + m[1] + ' >= ' + m[2]);
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
  const floor = /export const SUN_EL_MIN = ([-\d.]+);/.exec(cfg);
  ok(floor, 'config.js must define SUN_EL_MIN');
  ok(Math.sin(Number(floor[1])) <= Number(m[1]) + 1e-6,
     'the sun drag floor (' + floor[1] + ' rad) stops before night saturates at sun.y = ' + m[1]);
  ok(/sunLightCol[\s\S]{0,260}nightAmount\(sun\)/.test(glsl), 'direct sunlight must fade at night');
  ok(/skyAmbCol[\s\S]{0,260}nightAmount\(sun\)/.test(glsl), 'sky ambient must fade at night');

  // Stage two: deepNight carries on below nightAmount to a sky with nothing
  // left in it. The drag floor has to REACH it, or the last part of the
  // control travels past anything the picture can still do.
  const dm = /float deepNight\(vec3 sun\) \{ return 1\.0 - smoothstep\(([-\d.]+), ([-\d.]+), sun\.y\); \}/.exec(glsl);
  ok(dm, 'deepNight must be a smoothstep on sun.y with edge0 < edge1');
  ok(Number(dm[1]) < Number(dm[2]), 'deepNight edges are inverted: ' + dm[1] + ' >= ' + dm[2]);
  ok(Number(dm[2]) <= Number(m[1]) + 1e-6,
     'deepNight should start where nightAmount finishes: it begins at ' + dm[2] + ', night saturates at ' + m[1]);
  ok(Math.sin(Number(floor[1])) <= Number(dm[1]) + 1e-6,
     'the sun drag floor (' + floor[1] + ' rad, sun.y = ' + Math.sin(Number(floor[1])).toFixed(3) +
     ') cannot reach deep night, which saturates at sun.y = ' + dm[1]);

  // Three terms are UNLIT constants: they do not multiply by the sun at all,
  // so without an explicit fade they stay bright over a black island. Each
  // one was visible as a bug -- teal sea, lit clouds, warm terrain bounce.
  ok(/vec3\(0\.90, 0\.60, 0\.40\) \* 0\.12 \* bnc \* \(1\.0 - nightAmount\(sun\)\)/.test(glsl),
     'the terrain bounce is an unlit constant and must be faded at night');
  ok(/glacial teal, unlit/.test(glsl) && /depth\) \* \(1\.0 - 0\.97 \* nightAmount\(sun\)\)/.test(glsl),
     'the sea body colour is unlit and must be faded at night');
  ok(/shade \*= mix\(vec3\(1\.0 - 0\.96 \* nightAmount\(sun\)\), sunLightCol\(sun\) \* 0\.78, 0\.5\);/.test(glsl),
     'only half the cloud shade is sun-lit; the other half must fade at night');
});

check('a hit drives the struck hull’s sphere fold to the slider maximum', () => {
  // The hit no longer just recolours: hullMinR2 pushes uBoxParam.y to
  // BOX_MINR2_MAX for the struck hull and lets it fall back, so the mandelbox
  // blows open. That constant is TUNEA.boxMinR's MAX, squared, and nothing in
  // the code connects the two -- widen the slider and the flash silently stops
  // reaching the end of its own range.
  const m = /const float BOX_MINR2_MAX = ([\d.]+);/.exec(glsl);
  ok(m, 'BOX_MINR2_MAX must be declared');
  const tune = fs.readFileSync(path.join(__dirname, '..', 'js', 'tune.js'), 'utf8');
  const knob = /boxMinR:\s*\{[^}]*?max:\s*([\d.]+)/.exec(tune);
  ok(knob, 'could not find TUNEA.boxMinR');
  const want = Number(knob[1]) * Number(knob[1]);
  ok(Math.abs(Number(m[1]) - want) < 1e-9,
     'BOX_MINR2_MAX is ' + m[1] + ' but boxMinR maxes at ' + knob[1] + ' (squared: ' + want + ')');
  ok(/float hullMinR2\(float id\)/.test(glsl), 'hullMinR2 must exist');
  ok(/mix\(uBoxParam\.y, BOX_MINR2_MAX, hit\)/.test(glsl),
     'the hit must interpolate the sphere fold toward the maximum');
  // the normal has to be taken on the SAME perturbed surface as the march, or
  // the hull is lit as its undeformed self while its silhouette moves
  ok(/#define SDE\(P\) shipDE\(shipLocal\(P, c, ca, sa\), h, hullMinR2\(id\)\)/.test(glsl),
     'alienNormal must use the same perturbed fold the march used');
});

check('no backtick inside the GLSL templates', () => {
  const ticks = (src.match(/`/g) || []).length;
  ok(ticks === 4, 'expected exactly 4 backticks (two template delimiters), found ' + ticks +
                  ' -- a stray one ends the shader string early');
});

process.exitCode = summary('shader') ? 1 : 0;
