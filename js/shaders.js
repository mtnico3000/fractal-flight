// GLSL vertex + fragment shader sources.
export const vsSrc = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const fsSrc = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uCamPos;
uniform mat3 uCamMat;
uniform vec3 uSunDir;
uniform float uFov;
uniform vec2 uJitter;
uniform float uPixScale;
uniform float uDetailFade;
uniform float uRayTol;           // 0 = vertical tolerance (old), 1 = along-ray
uniform float uHitRefine;        // v9.5: 1 = refine the terrain hit onto the surface after the tolerance stop
uniform float uMarchStride;      // v9.5: minimum stride per unit t (was a constant 0.0018)
uniform float uRelaxMtn;         // 13 Sept 2026: step relaxation where the mountains are (0.55 = v9.5, 0.35 = safe against 70 deg faces)
uniform float uTreePersp;        // v9.5: 1 = trees shrink with distance (the v4.6 look), 0 = true size
uniform float uWaterLOD;         // 0 = un-LOD'd ripples (old), 1 = footprint-aware
uniform float uBoxRound;         // hull corner fillet, as a fraction of the smallest half-extent
// Where the melt stops collapsing and starts merely sitting there. MUST match
// MELT_KNEE in js/aliens.js -- the JS drives the melt value, this only decides
// how it is COLOURED, and test_shader.js checks the two agree.
const float MELT_KNEE = 0.78;
uniform float uDebugMask;        // bitmask of false-colour diagnostic channels (see main)    // A1 knob: multiplies the LOD footprint. 0 = full detail everywhere (pre-A1 look), 1 = Nyquist-matched, 2 = aggressive
uniform vec3 uCraftPos;
uniform vec3 uBulletPos[8];   // live tracer rounds; unused slots parked at y = -9999
uniform vec3 uBombPos[3];     // falling bombs; unused slots parked at y = -9999
uniform vec2 uBlastCell[64];  // xz centers of cells a detonation is querying (1e7 = idle)
uniform vec4 uCloudPos[16];   // cumulonimbus: xyz center, w radius (v4.3)
uniform float uCloudN;        // active cloud count
uniform mat3 uCraftMat;
uniform vec4 uRingsPos[8];    // ring course (jul): xyz center, w radius (w<=0 = inactive)
uniform mat3 uRingMats[8];    // ring orientation [right | up | fwd]
uniform vec3 uLivery;         // craft accent color (nose / wingtips / fin), start-page picker
uniform float uCockpit;       // 1 = pilot view: the craft itself is not drawn
uniform float uShadows;       // shadow pack master toggle (tune panel)
uniform vec3 uFxPos[48];      // overlay-particle occlusion queries (probe row px 85..132)
// ---- alien fleet (v9.0) ----
uniform vec3 uMotherPos;      // mothership center (axis-aligned, long axis = z)
uniform vec3 uMotherHalf;     // half extents (w/2, h/2, l/2)
uniform float uMotherMelt;    // 0 live · 0..1 melting glow
uniform vec4 uRelay;          // relayship: xyz + radius (grows with harvest)
uniform float uRelayMelt;
uniform vec2  uAlienHit;         // x = hull id (matches mal.y), y = flash 1..0
uniform vec4  uBolts[6];         // (source id 0..5 ship / 6 relay, head, tail, fade)
uniform float uBoltN;
uniform vec4 uShipPos[6];     // harvesters: xyz + heading
uniform float uShipLaser[6];  // 1 = harvest sheet active
uniform float uShipMelt[6];
uniform float uShipN;
uniform vec3 uShipHalf;       // harvester half extents (len/2, h/2, w/2)
uniform vec4 uBoxParam;       // mandelbox: scale, minR2, fold, bulb power
// ---- live tuning knobs (bottom-left panel) ----
uniform float uOceanSlope;   // how fast the sea floor drops away from land
uniform float uOceanMax;     // max ocean depth below the noise floor
uniform float uMassDecay;    // coast width: mountain mass falloff per meter
uniform float uMountAmp;     // ridge amplitude
uniform float uSnowLine;     // altitude where snow begins
uniform float uFogDens;      // atmospheric fog density
uniform vec2  uJuliaC;       // alien flora Julia-set parameter c
uniform float uSnowFrac;     // target fraction of ranges tall enough for snow
uniform float uFloraDens;    // 3D flora density (fraction of cells with a plant)
uniform float uFloraRange;   // max distance at which 3D flora is marched
uniform float uTreeSize;     // max plant size (m)
uniform float uTreeShare;    // fern→tree balance (higher = more big trees)
uniform float uTreeTiers;    // number of frond tiers up the plant
uniform float uTreeFract;    // Julia-set modulation of the frond silhouette
uniform sampler2D uCollected; // 512x512 bitmask of harvested plant cells (world wraps every ~13.3 km)

out vec4 fragColor;

const float WATER_LEVEL = -8.0;
const float T_MAX = 22000.0;

// ---------- hash & noise ----------
// v4.5: Hoskins hash12. The old fract(p*(123.34,456.21)) hash had strong
// row/column correlation — value noise inherited it as an axis-aligned
// blocky grid no interpolant could hide. This one is decorrelated.
// NOTE: continents/massifs are Mandelbrot-driven and unaffected; surface
// detail (ridges, lakes, tree spots) re-rolls to a fresh variation.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // quintic fade (C2): unlike the cubic, its 2nd derivative is continuous at
  // cell borders, so lighting no longer picks up creases along the lattice.
  // Lattice-point values are unchanged → the world layout is identical.
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// grid-hiding rotations (v4.2): OCT_ROT turns each fbmR octave ~37° so cell
// borders never stack on the same axes; DECOR_ROT decorrelates decorative
// (color/ripple) lattices from the terrain-shape lattice. Exact 3-4-5
// rotation (0.8/0.6) — fp32-friendly.
const mat2 OCT_ROT   = mat2(0.8,  0.6, -0.6, 0.8);
const mat2 DECOR_ROT = mat2(0.8, -0.6,  0.6, 0.8);
// ---------- footprint-aware detail (ROADMAP A1) ----------
// ANALYTIC MIPMAPPING. A raymarcher takes ONE sample per pixel, so any detail
// whose wavelength is under ~2 pixel footprints is below Nyquist: it cannot be
// resolved, and as the camera moves each frame's sample lands somewhere else
// on it and flips. That is the ground sparkle and the silhouette crawl
// (docs/RESEARCH.md §3, causes 1 and 3). The cure is not to sample it harder
// but to REMOVE it before sampling — smoothly, exactly where it stops being
// resolvable — which also makes distant pixels CHEAPER.
//
//   px   = the pixel's ground footprint in metres (march distance x uPixScale,
//          scaled by the 'detail fade' knob).
//   freq = this octave's world-space frequency in cycles/metre, so it spans
//          1/freq metres and hits Nyquist at px * freq == 0.5.
//
// px == 0 gives weight 1 for EVERY octave and mix(mean, n, 1.0) returns n
// exactly, so the plain fbm/fbmR/ridged wrappers below — and therefore
// terrainShape() — stay bit-identical to what they always computed. That
// matters: terrainShape is the collision authority the GPU probe row and the
// terrain.js mirror both depend on, and it must not move.
float octW(float freq, float px) {
  return 1.0 - smoothstep(0.25, 0.70, px * freq);
}
// Faded octaves must decay toward the octave's MEAN, never toward zero.
// Toward zero, dropping detail also lowers the average height, so distant
// mountains would sink as you flew at them — a systematic sub-pixel shift
// across a whole silhouette, which reads as LOD breathing. Both constants are
// measured, not guessed: 400k samples of the real noise() (see git history).
// E[n*prev] came out at 0.2006 == 0.4475^2, i.e. successive ridged octaves are
// independent, so fading n toward E[n] gets the product right for free.
const float NOISE_MEAN = 0.4991;   // E[noise()]
const float RIDGE_MEAN = 0.4475;   // E[(1 - |2*noise()-1|)^2], the ridged octave term
float noiseLOD(vec2 p, float freq, float px) {
  float w = octW(freq, px);
  return (w <= 0.0) ? NOISE_MEAN : mix(NOISE_MEAN, noise(p), w);
}
float fbmLOD(vec2 p, float freq, int oct, float px) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float w = octW(freq, px);
    // skipping the noise() call — 4 hashes — is where the GPU time comes back
    v += a * ((w <= 0.0) ? NOISE_MEAN : mix(NOISE_MEAN, noise(p), w));
    p = p * 2.0 + vec2(13.7, 7.3);
    a *= 0.5;
    freq *= 2.0;
  }
  return v;
}
float fbmRLOD(vec2 p, float freq, int oct, float px) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float w = octW(freq, px);
    v += a * ((w <= 0.0) ? NOISE_MEAN : mix(NOISE_MEAN, noise(p), w));
    p = OCT_ROT * p * 2.0 + vec2(13.7, 7.3);
    a *= 0.5;
    freq *= 2.0;
  }
  return v;
}
float ridgedLOD(vec2 p, float freq, int oct, float px) {
  float v = 0.0, a = 0.5, prev = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float w = octW(freq, px);
    float nm;
    if (w <= 0.0) {
      nm = RIDGE_MEAN;
    } else {
      float n = 1.0 - abs(noise(p) * 2.0 - 1.0);
      nm = mix(RIDGE_MEAN, n * n, w);
    }
    v += a * nm * prev;
    prev = nm;              // feed the faded value forward, or the coupling
    p = p * 2.0 + vec2(7.3, 13.7);   // would keep re-injecting the octave we
    a *= 0.5;                        // just removed
    freq *= 2.0;
  }
  return v;
}
// Full-detail wrappers. freq 0 makes px * freq 0 at every octave, so these are
// the exact loops they were before A1 — one body each, no second copy to drift.
float fbm(vec2 p, int oct)    { return fbmLOD(p, 0.0, oct, 0.0); }
// rotated-octave fbm — DECORATIVE USE ONLY (clouds, color detail). Never for
// terrainShape or its mirrors: rotating shape octaves would move the world.
float fbmR(vec2 p, int oct)   { return fbmRLOD(p, 0.0, oct, 0.0); }
float ridged(vec2 p, int oct) { return ridgedLOD(p, 0.0, oct, 0.0); }
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
// Smooth MAX — rounds the join where peaks meet the valley floor.
float smax(float a, float b, float k) {
  return -smin(-a, -b, k);
}

// ---------- REAL Mandelbrot macro structure ----------
// Escape-time iteration z -> z^2 + c over the world's xz plane, with the
// analytic distance estimator DE = |z|·ln|z| / |z'|. Mountain ranges rise
// where DE -> 0, i.e. they trace the actual coastline of the Mandelbrot set,
// with its genuine self-similar bays, filaments and mini-brots.
// ~26 complex mults is far cheaper than the old 26 gradient-noise evals.
const vec2  MB_CENTER = vec2(-0.55, 0.0);   // which part of the set you fly over
const float MB_SCALE  = 2.5e-4;             // world units -> complex plane (set spans ~12 km)

float mandelDE(vec2 c, int maxIter) {
  vec2 z = vec2(0.0), dz = vec2(0.0);
  float m2 = 0.0;
  for (int i = 0; i < 26; i++) {
    if (i >= maxIter) break;
    dz = 2.0 * vec2(z.x*dz.x - z.y*dz.y, z.x*dz.y + z.y*dz.x) + vec2(1.0, 0.0);
    z  = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    m2 = dot(z, z);
    if (m2 > 1e6) break;
  }
  if (m2 < 4.0) return 0.0;                          // inside the set → range core
  return sqrt(m2 / max(dot(dz, dz), 1e-12)) * 0.5 * log(m2);
}

// ---------- terrain shape ----------
// Geometry is a fixed function of position (no camera-distance terms) — that's
// what keeps summits rock-solid while flying.
//
// WORLD LAYOUT (all genuinely Mandelbrot):
//  · Layer 1 = home island: the set's interior is the massif you spawn over;
//    its coastline carries the ranges. Mini-brots & filaments around the set
//    become island chains and islets in the ocean FOR FREE — e.g. the big
//    period-3 mini-brot sits ~4.8 km west of spawn.
//  · Layer 2 = mega-continent: the same set, zoomed out 2.5x, centered ~14 km
//    north. Fly over open water and it rises on the horizon.
//  · Noise shoals: far from both sets the sea floor undulates, so a few small
//    random islets break the surface between the fractal ones.
const vec2  MB2_CENTER = vec2(-0.55, 0.0);
const float MB2_SCALE  = 1.0e-4;                 // 2.5x larger than home island
const vec2  MB2_OFFSET = vec2(0.0, 14000.0);     // world position of continent core

float worldDE(vec2 p, int it) {                  // distance-to-land in WORLD meters
  float w1 = mandelDE(p * MB_SCALE + MB_CENTER, it) / MB_SCALE;
  float w2 = mandelDE((p - MB2_OFFSET) * MB2_SCALE + MB2_CENTER, it) / MB2_SCALE;
  return min(w1, w2);
}

// terrainShapeLOD is the ONE body. px is the pixel's ground footprint in
// metres; 0 means full detail. The Mandelbrot iteration count is deliberately
// NOT faded — worldDE sets where the coastlines are, and dropping iterations
// would move a silhouette by far more than a pixel, which is the opposite of
// what A1 is for. Only the noise octaves, whose amplitude is proportional to
// their wavelength, fade out sub-pixel.
float terrainShapeLOD(vec2 p, float px, out float mass) {
  float wde  = worldDE(p, 26);
  mass = exp(-wde * uMassDecay);                 // mountain mass hugs the coastlines

  // Land near the sets, ocean floor sloping away from them
  float baseElev = fbmLOD(p * 0.0004, 0.0004, 3, px) * 70.0 + 4.0 - clamp(wde * uOceanSlope, 0.0, uOceanMax);

  // Local alpine relief: light domain warp + FIXED 5 ridged octaves
  vec2 q  = vec2(fbmLOD(p * 0.0009, 0.0009, 3, px), fbmLOD(p * 0.0009 + vec2(5.2, 1.3), 0.0009, 3, px));
  vec2 pw = p + q * 60.0;

  // Per-massif height variability: a slow (~5 km) selector field decides which
  // ranges are TALL (reach the snow line) vs modest. uSnowFrac slides the
  // threshold so roughly that fraction of mountain area goes snowy.
  float rangeSel = fbmLOD(p * 0.00018, 0.00018, 2, px);
  // Calibrated so P(selector > threshold) ~= uSnowFrac (empirical quantile fit
  // of this fbm's value distribution): frac 0.2 -> th 0.28, 0.5 -> 0.17, 1 -> 0.
  float tallTh   = 17.3 / (uSnowFrac + 6.44) - 2.32;
  float tall     = smoothstep(tallTh - 0.05, tallTh + 0.05, rangeSel);
  float ampScale = mix(0.42, 1.1, tall);   // modest ranges stay below the snow line; tall ones clear it

  float mountain = (80.0 + uMountAmp * ridgedLOD(pw * 0.0016, 0.0016, 5, px)) * mass * ampScale;

  // Rounded summits: smooth tanh saturation → domed peaks, no razor tips
  mountain = 460.0 * tanh(mountain / 460.0);
  mountain -= 70.0 * (1.0 - mass);   // sink the term over open ocean so smax() lets the sea floor win

  float h = smax(baseElev, mountain, 45.0);

  // Interior lakes: only on high ground (mass) and away from the peaks
  float valley = fbmLOD(p * 0.0003 + 200.0, 0.0003, 3, px);
  float lake = smoothstep(0.58, 0.72, valley)
             * smoothstep(0.4, 0.9, mass)
             * (1.0 - smoothstep(30.0, 80.0, mountain));
  h = mix(h, -15.0, lake * 0.65);
  return h;
}
// The same terrain without the mass output. GLSL inlines both at every call
// site, so the overload costs nothing; only the march wants mass, to key
// its step relaxation.
float terrainShapeLOD(vec2 p, float px) { float mass; return terrainShapeLOD(p, px, mass); }

// The canonical, full-detail terrain. COLLISION AUTHORITY: the GPU probe row
// and the terrain.js CPU mirror both answer with this, so it must stay exactly
// what it was before A1 — hence px = 0 and not the marching footprint.
float terrainShape(vec2 p) { return terrainShapeLOD(p, 0.0); }

// Cheap variant for shadow rays: fewer iterations, 2 noise octaves.
float terrainCheapH(vec2 p) {
  float wde  = worldDE(p, 13);
  float mass = exp(-wde * uMassDecay);
  float tallTh = 17.3 / (uSnowFrac + 6.44) - 2.32;
  float tall = smoothstep(tallTh - 0.05, tallTh + 0.05, fbm(p * 0.00018, 2));
  float mountain = (80.0 + uMountAmp * ridged(p * 0.0016, 2)) * mass * mix(0.42, 1.1, tall);
  mountain = 460.0 * tanh(mountain / 460.0) - 70.0 * (1.0 - mass);
  float base = fbm(p * 0.0004, 2) * 70.0 + 4.0 - clamp(wde * uOceanSlope, 0.0, uOceanMax);
  return smax(base, mountain, 45.0);
}

// ---------- 3D alien fern flora ----------
// Real geometry, folded into the main terrain march. Each 26 m ground cell may
// host one plant: a tiered, scalloped cone silhouette — fern (1.6 m) up to
// tree (13 m), size^2.4-biased so ferns are common and trees rare.
// The trick that keeps it nearly FREE: the plant is anchored using dTerr, the
// height-above-terrain the march has ALREADY computed this step, so no extra
// terrain evaluations. Rays cruising above the canopy reject in one compare.
const float FCELL = 26.0;
// returns vec3(conservative distance, cell random, normalized height on plant)
vec3 plantEval(vec3 p, float dTerr, float mt) {
  // mt = march distance to this sample (0 for collision probes).
  // mt < 550: full silhouette (fronds + Julia carve). Beyond: mean-envelope
  // LOD — and (v4.6) EXAGGERATED PERSPECTIVE: the tree's size itself shrinks
  // with distance, down to 35% at 4 km, so far groves read as tiny specks
  // that visibly grow on approach. Probes pass mt = 0 → collision unchanged.
  float hg = p.y - dTerr;                          // ground height in this column
  vec2 cell = floor(p.xz / FCELL);
  float rnd = hash(cell);
  if (rnd > uFloraDens || hg < 5.0 || hg > 140.0) return vec3(1e5, 0.0, 0.0); // greenbelt only
  // harvested plants are gone — one texel per cell
  if (texelFetch(uCollected, ivec2(mod(cell, 512.0)), 0).r > 0.5) return vec3(1e5, 0.0, 0.0);
  float s = mix(1.6, uTreeSize, pow(hash(cell + 51.0), mix(5.0, 1.2, uTreeShare))); // fern → tree
  // v9.5: the shrink is a form that changes as you fly past it -- exactly the
  // class of motion Nico asked to remove -- so it is a knob now, default off.
  s *= mix(1.0, 0.35, smoothstep(550.0, 4000.0, mt) * uTreePersp);   // distance shrink (visual only)
  vec2 ctr = (cell + 0.5) * FCELL + (vec2(hash(cell + 13.0), hash(cell + 37.0)) - 0.5) * 12.0;
  float ly = dTerr;                                // height above ground
  float yn = clamp(ly / s, 0.0, 1.0);
  vec2 d2 = p.xz - ctr;
  float crown  = pow(sin(clamp((yn - 0.30) / 0.70, 0.0, 1.0) * 3.14159), 0.8);
  if (mt >= 550.0) {
    // far LOD: frond-less mean envelope, no trig, no Julia
    float Rf = s * (0.045 + 0.46 * crown * 0.72);
    float df = max(length(d2) - Rf, ly - s);
    return vec3(df * 0.45, rnd, yn);
  }
  // ALIEN TREE-FERN silhouette (v1.6): slim bare stalk, then a crown of
  // arched fronds that flares widest around 3/4 height and folds back in at
  // the tip — the inverse of a pine. uTreeTiers = number of fronds around
  // the axis, with a slight spiral twist up the stalk.
  float az     = atan(d2.y, d2.x);
  float azFade = clamp(length(d2) / (0.35 * s), 0.0, 1.0);  // Lipschitz: no angular chop near the axis
  float lobes  = 0.45 + 0.55 * abs(sin(az * (uTreeTiers * 0.5) + rnd * 6.28 + yn * 2.2));
  float fronds = mix(1.0, lobes, azFade);
  float R = s * (0.045 + 0.46 * crown * fronds);
  // v1.5: GENUINE fractal fronds — a small Julia iteration (z -> z^2 + c,
  // same c as the undergrowth, so the flora knobs shape both) sampled in the
  // (height, azimuth) plane carves the silhouette into self-similar lobes.
  if (uTreeFract > 0.001 && R > 0.05) {
    vec2 zj = vec2(yn * 2.0 - 1.0, az * 0.318);
    float fj = 0.0;
    for (int i = 0; i < 5; i++) {
      zj = vec2(zj.x * zj.x - zj.y * zj.y, 2.0 * zj.x * zj.y) + uJuliaC;
      if (dot(zj, zj) > 9.0) break;
      fj += 0.2;
    }
    R *= mix(1.0, 0.6 + 0.8 * fj, uTreeFract);
  }
  float d = max(length(d2) - R, ly - s);
  return vec3(d * 0.45, rnd, yn);                  // 0.45 = Lipschitz margin for the fractal scallops
}

// ---------- alien Mandelbrot flora (2D undergrowth pattern) ----------
// Each ~42 m cell of the greenbelt hosts one dendritic JULIA growth
// (z -> z^2 + c with c near the set's boundary → branching, fern-like
// filaments). Per-cell hash rotates the plant and perturbs c so no two
// growths are identical. Shading only — zero geometry cost.
float alienFlora(vec2 p) {
  vec2 cell = floor(p / 42.0);
  vec2 uv = (fract(p / 42.0) - 0.5) * 3.4;
  float rot = hash(cell) * 6.2831;
  float cs = cos(rot), sn = sin(rot);
  uv = mat2(cs, -sn, sn, cs) * uv;
  vec2 c = uJuliaC + vec2(hash(cell + 3.0) * 0.05, hash(cell + 7.0) * 0.07);
  vec2 z = uv;
  float it = 0.0;
  for (int i = 0; i < 11; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 16.0) break;
    it += 1.0;
  }
  return it / 11.0;   // → 1 on the Julia filaments = the "plant"
}

vec3 terrainColor(vec3 pos, vec3 normal, float h, float pixelSize) {
  float slope = 1.0 - normal.y;
  // A1: these decorative lattices are the WORST offenders in the whole frame.
  // The vegetation mottle runs at 0.6 cycles/m — a 1.7 m wavelength — so it is
  // already ~4x past Nyquist for a 3.5 m footprint, which is only 2 km out.
  // Geometry octaves alias in the far distance; these alias almost everywhere,
  // which is why the ground sparkled even where the mountains sat still.
  float px = pixelSize * uDetailFade;

  // ---- strict altitude bands: sand → vegetation → rock → snow ----
  float sandAmt = 1.0 - smoothstep(3.0, 12.0, h);                         // shoreline
  float vegAmt  = smoothstep(4.0, 16.0, h) * (1.0 - smoothstep(95.0, 145.0, h));
  float rockAmt = smoothstep(95.0, 145.0, h) * (1.0 - smoothstep(uSnowLine, uSnowLine + 50.0, h));
  float snowAmt = smoothstep(uSnowLine, uSnowLine + 50.0, h);                            // tops only
  // slope corrections: cliffs are bare rock at any altitude; snow clings to flatter tops
  float cliff = smoothstep(0.5, 0.78, slope);
  snowAmt *= 1.0 - smoothstep(0.32, 0.58, slope);
  snowAmt *= 0.75 + 0.25 * noiseLOD(DECOR_ROT * pos.xz * 0.08, 0.08, px);  // fractal snow edge

  vec3 sandCol = mix(vec3(0.62, 0.55, 0.40), vec3(0.70, 0.64, 0.48), noiseLOD(DECOR_ROT * pos.xz * 0.15, 0.15, px));

  // vegetation: lush greens + alien Julia flora
  vec3 vegCol = mix(vec3(0.12, 0.28, 0.09), vec3(0.18, 0.36, 0.12), noiseLOD(DECOR_ROT * pos.xz * 0.6, 0.6, px));
  if (pixelSize < 5.0) {
    float fl = alienFlora(pos.xz);
    vec3 alien = mix(vec3(0.04, 0.20, 0.10), vec3(0.10, 0.46, 0.30), fl);
    alien += vec3(0.06, 0.34, 0.26) * smoothstep(0.78, 1.0, fl);          // luminous vein tips
    vegCol = mix(vegCol, alien, smoothstep(0.30, 0.85, fl) * (1.0 - smoothstep(3.0, 5.0, pixelSize)));
  }

  vec3 rockCol = mix(vec3(0.33, 0.25, 0.18), vec3(0.48, 0.40, 0.32), noiseLOD(DECOR_ROT * pos.xz * 0.03, 0.03, px));
  rockCol = mix(rockCol, vec3(0.40, 0.34, 0.28), fbmRLOD(pos.xz * 0.15, 0.15, 3, px) * 0.6); // strata

  // assemble by altitude, then slope overrides, then snow on top
  vec3 col = sandCol;
  col = mix(col, vegCol, vegAmt);
  col = mix(col, rockCol, max(rockAmt, cliff * smoothstep(6.0, 20.0, h)));
  vec3 snowCol = mix(vec3(0.80, 0.85, 0.94), vec3(0.96, 0.97, 1.0), normal.y);
  col = mix(col, snowCol, snowAmt);
  return col;
}

// ---------- terrain normal (footprint-matched epsilon = stable shading) ----------
vec3 terrainNormal(vec2 p, float pixelSize) {
  float e = max(0.4 * pixelSize, 0.15);
  // the normal must describe the surface actually being DRAWN, so it samples
  // the same faded terrain the march hit — otherwise shading would keep
  // lighting detail the geometry no longer has
  float px = pixelSize * uDetailFade;
  float hL = terrainShapeLOD(p - vec2(e, 0.0), px);
  float hR = terrainShapeLOD(p + vec2(e, 0.0), px);
  float hD = terrainShapeLOD(p - vec2(0.0, e), px);
  float hU = terrainShapeLOD(p + vec2(0.0, e), px);
  return normalize(vec3(hL - hR, 2.0 * e, hD - hU));
}

// ---------- terrain raymarch (sphere-traced heightfield + linear refine) ----------
// returns vec2(t, material): material 1 = terrain, 4 = plant, t<0 = miss
// iters is only for the debug views below -- nothing in the render path
// reads it, and the collision probe row does not call this function at all.
vec2 marchTerrain(vec3 ro, vec3 rd, out float iters) {
  float t = 0.5;
  float pt = t, pd = 1e5, pdT = 1e5;
  float dT = 1e5, dP = 1e5, mass = 0.0;
  // v9.5 HIT REFINE runs INSIDE this loop, as phases, so terrainShapeLOD has
  // exactly ONE call site. GLSL inlines every call: a first version with a
  // separate refine block -- four more inlined copies of the terrain function
  // -- made the whole shader slower PER ITERATION, +65% frame time for +17%
  // iterations, and pushed the driver compile to 160 s. Same maths, one copy.
  int phase = 0;                       // 0 marching, 1 secant probe, 2..4 bisection
  float lo = 0.0, hi = 0.0, dStop = 0.0;
  iters = 384.0;
  for (int i = 0; i < 384; i++) {
    iters = float(i);
    vec3 p = ro + rd * t;
    if (phase == 0 && p.y > 560.0 && rd.y > 0.0) return vec2(-1.0, 0.0); // above the tallest peak, heading up
    // A1: sample the terrain at THIS step's footprint. Detail thins with
    // distance along the ray, which is both the shimmer fix and the reason
    // long rays got cheaper rather than more expensive.
    dT = p.y - terrainShapeLOD(p.xz, t * uPixScale * uDetailFade, mass);
    if (phase == 1) {
      // The probe. If the extrapolation crossed the surface we now HAVE a
      // bracket, so bisect it three times; if not, keep it only when closer.
      if (dT < 0.0) { hi = t; phase = 2; t = 0.5 * (lo + hi); continue; }
      return vec2((dT < dStop) ? t : lo, 1.0);
    }
    if (phase >= 2) {
      if (dT < 0.0) hi = t; else lo = t;
      if (phase == 4) return vec2(0.5 * (lo + hi), 1.0);
      phase++; t = 0.5 * (lo + hi); continue;
    }
    // 3D flora: only evaluated when the ray is close AND skimming near the
    // ground — cruising altitude pays a single compare per step.
    dP = 1e5;
    if (t < uFloraRange && dT < 18.0 && dT > -1.0) dP = plantEval(p, dT, t).x;
    // 13 Sept 2026: 0.55 x the VERTICAL gap is not a safe step against a face
    // steeper than ~61 deg (the safe factor is 1/tan(slope)), and from below
    // a ridge the sample after the last one in front of the face lands past
    // the thin crest: the top ~15 m of a crest 400 m away was found or lost by
    // the sample phase alone -- 30 px of horns and floating pieces that moved
    // with every tap (RESEARCH.md s6.9). uRelaxMtn applies where the
    // mountains are (mass -> 1, the same factor that raises them inside
    // terrainShape); the sea and the beach keep 0.55, which is safe on their
    // slopes and where a shorter step would cost +47% for nothing.
    float relax = mix(0.55, uRelaxMtn, smoothstep(0.25, 0.60, mass));
    float d = min(dT * relax, dP);   // relaxed terrain stride, cautious near plants
    // Stop when the surface is within about a pixel ALONG THE RAY, not within
    // a pixel VERTICALLY. dT is a height above the heightfield, so a vertical
    // slop of e leaves the hit e/sin(incidence) short of the true crossing --
    // 6x at 9.5 degrees of depression, 19x at 3. THAT amplification was the
    // concentric rings centred on the nadir (v9.4): the march halts early by a
    // distance proportional to t, quantised by the discrete step, so the error
    // sawtoothed every ~350 m of ground radius out to the horizon, survived
    // supersampling (it is geometric, not sampling), and swam with the camera
    // because it is keyed on distance FROM the camera.
    //
    // dP is already a distance along the ray, so the plant test keeps the
    // isotropic tolerance. The 0.06 floor stops near-horizontal rays from
    // demanding unreachable precision; anything in 0.02..0.10 measures the same.
    float tolRay = 0.01 + 0.0015 * t;
    float inc = mix(1.0, max(abs(rd.y), 0.06), uRayTol);
    if (dT < tolRay * inc || dP < tolRay) {
      bool plant = dP < dT;
      // the terrain crossing from the last two GAPS: with a relaxation that
      // varies along the ray the step is no longer a fixed multiple of the
      // gap, so pd/(pd - d) would misplace it. Plants keep the step ratio (dP
      // is a distance along the ray, not a gap).
      float w = plant ? clamp(pd / (pd - d), 0.0, 1.0) : clamp(pdT / (pdT - dT), 0.0, 1.0);
      float th = mix(pt, t, w);
      // The tolerance stop leaves the hit ABOVE the surface by up to
      // tolRay*inc -- 1.2 m mean, 3.2 m p99 at 4 km -- and that height is what
      // terrainColor keys every altitude band on, what the shadow ray starts
      // from, and (along the ray) where every texture is sampled. On a 2.35%
      // beach a metre of it moves the sand/green line 43 m. Secant-extrapolate
      // along the last two terrain gaps to the crossing, bounded to two more
      // strides, and let the loop evaluate it (phase 1). Only while the gap is
      // still SHRINKING: a growing gap is a ray cresting a bump, and
      // extrapolating forward would hand it to the far side. Measured on the
      // mirror (RESEARCH.md s6): residual 0.24 -> 0.04 m, and frame-to-frame
      // land/water/sky flips over a grazing beach 15 -> 4, the reference
      // marcher's own parallax count, for ~1.7 extra evaluations per pixel.
      if (!plant && dT > 0.0 && pdT > dT && pdT < 1e4 && uHitRefine > 0.5) {
        lo = t; dStop = dT;
        // Bounded to two strides OR one tolRay, whichever is larger: with a
        // small stride floor the last step near a stop is short, and two of
        // it could not reach the crossing on a shallow beach (residual 0.05 ->
        // 0.34 m at 4 km when the floor went to 0.0002). tolRay is exactly the
        // along-ray distance a within-tolerance gap can still need.
        t = min(t + dT * (t - pt) / (pdT - dT), t + max(2.0 * (t - pt), tolRay));
        phase = 1;
        continue;
      }
      return vec2(th, plant ? 4.0 : 1.0);
    }
    pt = t; pd = d; pdT = dT;
    // The minimum stride is what lets a grazing ray make progress over flat
    // ground at all. It was a constant 0.0018*t -- 5.4 m at 3 km -- which
    // stepped clean over beach berms shorter than that and landed the hit up
    // to 45 m further along (p99, over-the-sea beach view), a different place
    // every frame. 0.0009 cut that to 9 m. Then the peaks: a ray shaving the
    // tip of a sharp ridge is below the surface for centimetres, and a floor
    // of 0.4 m (0.0009 at 450 m) steps over that clip or not depending on
    // where the camera is -- the crest "breathes" as you advance. Measured on
    // 36 such rays over a 40 m slide: misses 222 -> 22 and flips 84 -> 14 at
    // 0.0002, for +13-22% iterations; relax was not the lever (0.15 with the
    // old floor still flipped 52 times). RESEARCH.md s6.7. Debug slider.
    t += d + t * uMarchStride;
    if (t > T_MAX) return vec2(-1.0, 0.0);
  }
  // v9.5: a ray that spends its whole budget crawling along a surface is AT
  // that surface, not in the sky. Returning -1 here turned budget exhaustion
  // into a hole -- sky, or WATER wherever the ray had already crossed the
  // water plane, i.e. a spike of sea into the beach -- that came and went
  // with the camera. Measured: 49 of 16 500 rays over a beach at 3 degrees,
  // 22 of 22 500 at a ridge. The horns on the hulls were this same bug on
  // marchAliens. 150 -> 384 makes it rare; this makes it harmless.
  return vec2(t, (dP < dT) ? 4.0 : 1.0);
}

// ---------- soft sun shadow (coarse LOD terrain → cheap & stable) ----------
float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0;
  float t = 4.0;
  for (int i = 0; i < 24; i++) {           // was 40
    vec3 p = ro + rd * t;
    if (p.y > 560.0) break;
    float h = p.y - terrainCheapH(p.xz);   // cheap 2-octave terrain for shadows
    res = min(res, 5.0 * h / t);
    if (res < 0.01) break;
    t += clamp(h, 6.0, 90.0);              // longer strides
  }
  return clamp(res, 0.0, 1.0);
}

// ---------- sky, sun, clouds ----------
// ---------- golden hour ----------
// As the sun approaches the horizon everything shifts to a California-sunset
// palette: deep orange horizon band, purple-blue zenith, reddened sunlight,
// warm fog, pink clouds. duskAmount goes 0 (day) → 1 (sun on the horizon).
float duskAmount(vec3 sun) { return 1.0 - smoothstep(0.06, 0.34, sun.y); }
vec3 sunLightCol(vec3 sun) { return mix(vec3(1.30, 1.02, 0.78), vec3(1.55, 0.55, 0.25), duskAmount(sun)); }
vec3 skyAmbCol(vec3 sun)   { return mix(vec3(0.42, 0.56, 0.82), vec3(0.46, 0.36, 0.52), duskAmount(sun)); }

vec3 skyColor(vec3 rd, vec3 sun) {
  float sd = clamp(dot(rd, sun), 0.0, 1.0);
  float dusk = duskAmount(sun);
  float horiz = 1.0 - smoothstep(0.0, 0.45, rd.y);
  vec3 horCol = mix(vec3(0.62, 0.70, 0.84), vec3(0.96, 0.44, 0.22), dusk);
  vec3 zenCol = mix(vec3(0.10, 0.24, 0.48), vec3(0.09, 0.10, 0.30), dusk);
  vec3 col = mix(horCol, zenCol, smoothstep(-0.05, 0.55, rd.y));
  // warm band around the low sun — widens and reddens at dusk
  vec3 band = mix(vec3(1.00, 0.58, 0.28), vec3(1.05, 0.30, 0.10), dusk);
  col = mix(col, band, pow(sd, mix(5.0, 2.6, dusk)) * horiz * mix(0.75, 0.95, dusk));
  col += mix(vec3(1.00, 0.72, 0.42), vec3(1.10, 0.42, 0.16), dusk) * pow(sd, 48.0) * 0.55;   // glow
  col += mix(vec3(1.00, 0.88, 0.65), vec3(1.05, 0.52, 0.28), dusk) * pow(sd, 900.0) * 3.0;   // disc
  // thin high clouds — lit pink from below at dusk
  if (rd.y > 0.015) {
    vec2 cuv = rd.xz / (rd.y + 0.18) * 1.4;
    float cl = fbmR(DECOR_ROT * (cuv * 2.0 + vec2(uTime * 0.012, 0.0)), 5);   // rotated 1st octave too
    float cm = smoothstep(0.52, 0.82, cl) * smoothstep(0.015, 0.16, rd.y);
    vec3 cc = mix(vec3(0.92, 0.93, 0.95), vec3(1.0, 0.82, 0.62), pow(sd, 3.0));
    cc = mix(cc, vec3(1.0, 0.58, 0.48), dusk * 0.7);
    col = mix(col, cc, cm * 0.65);
  }
  return col;
}

// ---------- height-weighted valley fog ----------
float fogFactor(vec3 ro, vec3 rd, float t) {
  float midY = max(ro.y + rd.y * t * 0.5, 0.0);
  float hf = exp(-midY * 0.004);
  return 1.0 - exp(-t * uFogDens * (0.26 + hf));
}
vec3 applyFog(vec3 col, vec3 ro, vec3 rd, float t, vec3 sun) {
  float f = fogFactor(ro, rd, t);
  float sd = clamp(dot(rd, sun), 0.0, 1.0);
  float dusk = duskAmount(sun);
  vec3 fbase = mix(vec3(0.58, 0.65, 0.78), vec3(0.72, 0.48, 0.44), dusk);
  vec3 fwarm = mix(vec3(1.0, 0.70, 0.40), vec3(1.05, 0.42, 0.20), dusk);
  vec3 fcol = mix(fbase, fwarm, pow(sd, 6.0));
  return mix(col, fcol, f);
}

// ---------- cumulonimbus (v4.3, lobed v4.4) ----------
// Each cloud is now a CLUSTER: one broad flat slab (the dark base) plus four
// cauliflower bubbles on top, placed by per-cloud hashes. A single bounding
// sphere gates the whole cluster, so rays that miss the cloud still pay just
// one quadratic; only rays inside test the 5 lobes and only hit lobes pay
// for noise. A hard smoothstep shelf flattens the underside — the classic
// anvil-bottom look. Clouds remain pure visuals: no collision, bullets and
// bombs pass straight through. Orderless accumulation as before.
vec4 cloudLayer(vec3 ro, vec3 rd, float tMax, vec3 sun) {
  float trans = 1.0, sumA = 0.0;
  vec3 sumC = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uCloudN) break;
    vec3 c = uCloudPos[i].xyz;
    float r = uCloudPos[i].w;
    // bounding sphere: one cheap test hides the whole cluster
    vec3 oc = ro - c;
    float bb = dot(oc, rd);
    float cc = dot(oc, oc) - 1.9 * r * r;        // radius 1.38r
    if (bb * bb - cc < 0.0) continue;
    if (bb > 0.0 && cc > 0.0) continue;          // cluster fully behind the ray
    float fi = float(i);
    for (int L = 0; L < 5; L++) {
      vec3 lc; vec3 ls;
      if (L == 0) {                              // broad flat base slab
        lc = c;
        ls = vec3(r, r * 0.38, r);
      } else {                                   // cauliflower bubble on top
        float fL = float(L);
        float a1 = hash(vec2(fi * 7.13, fL * 3.71)) * 6.2831;
        float rr = (0.12 + 0.38 * hash(vec2(fi * 2.17, fL * 5.31))) * r;
        float br = (0.30 + 0.22 * hash(vec2(fi * 4.91, fL * 1.77))) * r;
        lc = c + vec3(cos(a1) * rr,
                      r * 0.16 + br * 0.55 + hash(vec2(fi + 0.7, fL)) * 0.22 * r,
                      sin(a1) * rr);
        ls = vec3(br, br * 0.92, br);
      }
      vec3 o = (ro - lc) / ls;
      vec3 d = rd / ls;
      float A = dot(d, d), B = dot(o, d), C = dot(o, o) - 1.0;
      float disc = B * B - A * C;
      if (disc <= 0.0) continue;
      float sq = sqrt(disc);
      float t0 = max((-B - sq) / A, 0.0);
      float t1 = min((-B + sq) / A, tMax);
      if (t1 <= t0) continue;
      float tm = 0.5 * (t0 + t1);
      vec3 pm = ro + rd * tm;
      // puffy erosion: world-anchored → drifting clouds slowly billow
      float e = fbmR((pm.xz + pm.y * 0.8) * (2.9 / r) + vec2(fi * 17.31, fi * 9.7), 3);
      float depth = (t1 - t0) / max(ls.x, 1.0);
      float dens = smoothstep(0.05, 0.80, depth * 0.60)
                 * smoothstep(0.32, 0.70, e + depth * 0.22);
      dens *= smoothstep(c.y - 0.52 * r, c.y - 0.30 * r, pm.y);   // FLAT underside shelf
      if (dens < 0.004) continue;
      // shade: dark flat base → bright bubbly top, dusk-warmed, silver lining
      float hIn = clamp((pm.y - (c.y - 0.40 * r)) / (1.5 * r), 0.0, 1.0);
      vec3 shade = mix(vec3(0.44, 0.47, 0.55), vec3(1.05, 1.03, 0.99), hIn);
      shade *= mix(vec3(1.0), sunLightCol(sun) * 0.78, 0.5);
      shade += vec3(1.0, 0.85, 0.65) * pow(clamp(dot(rd, sun), 0.0, 1.0), 10.0) * 0.35;
      shade = applyFog(shade, ro, rd, tm, sun);  // distant clouds sink into haze
      float a = dens * 0.82;
      sumC += shade * a;
      sumA += a;
      trans *= 1.0 - a;
    }
  }
  if (sumA < 1e-4) return vec4(0.0);
  return vec4(sumC / sumA, 1.0 - trans);
}

// ---------- chase aircraft (SDF, rendered in the same scene) ----------
float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float sdEll(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}
// Local frame: +z = nose, +y = up, +x = right wing
float sdCraft(vec3 p) {
  float d = sdEll(p, vec3(0.50, 0.42, 2.30));                              // fuselage
  d = min(d, sdEll(p - vec3(0.0, 0.30, 0.55), vec3(0.28, 0.24, 0.72)));    // canopy
  vec3 w = p - vec3(0.0, -0.05, 0.25);
  w.z += abs(w.x) * 0.28;                                                   // wing sweep
  d = min(d, sdBox(w, vec3(3.10, 0.05, 0.52 - abs(w.x) * 0.06)));          // wings
  vec3 tp = p - vec3(0.0, 0.06, -2.00);
  tp.z += abs(tp.x) * 0.32;
  d = min(d, sdBox(tp, vec3(1.05, 0.04, 0.30)));                            // tailplane
  vec3 f = p - vec3(0.0, 0.45, -2.05);
  f.z += f.y * 0.55;
  d = min(d, sdBox(f, vec3(0.04, 0.52, 0.32)));                             // fin
  return d;
}
vec3 toCraftLocal(vec3 wp) {
  return transpose(uCraftMat) * (wp - uCraftPos);
}
float marchCraft(vec3 ro, vec3 rd) {
  if (uCockpit > 0.5) return -1.0;   // pilot view: we ARE the plane
  // bounding sphere first — skip the SDF entirely for most rays
  vec3 oc = ro - uCraftPos;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - 22.0;   // r ≈ 4.7
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0);
  float t1 = -b + sq;
  if (t1 < 0.0) return -1.0;
  float t = t0;
  for (int i = 0; i < 64; i++) {
    float d = sdCraft(toCraftLocal(ro + rd * t));
    if (d < 0.004) return t;
    t += d;
    if (t > t1) return -1.0;
  }
  return -1.0;
}
vec3 craftNormal(vec3 wp) {
  vec3 lp = toCraftLocal(wp);
  vec2 e = vec2(0.01, 0.0);
  vec3 n = normalize(vec3(
    sdCraft(lp + e.xyy) - sdCraft(lp - e.xyy),
    sdCraft(lp + e.yxy) - sdCraft(lp - e.yxy),
    sdCraft(lp + e.yyx) - sdCraft(lp - e.yyx)));
  return uCraftMat * n;
}

// ---------- score rings (ported from jul's fractal-flight) ----------
// Torus in the ring's local frame, axis along local z (the fly-through axis).
float sdTorusZ(vec3 p, float r, float th) {
  vec2 q = vec2(length(p.xy) - r, p.z);
  return length(q) - th;
}

float marchRings(vec3 ro, vec3 rd) {
  float tBest = 1e5;
  for (int i = 0; i < 8; i++) {
    if (uRingsPos[i].w <= 0.0) continue;
    vec3 p = uRingsPos[i].xyz;
    vec3 oc = ro - p;
    float b = dot(oc, rd);
    float r = uRingsPos[i].w;
    float c = dot(oc, oc) - (r * r + 10.0);
    float disc = b * b - c;
    if (disc < 0.0) continue;
    float sq = sqrt(disc);
    float t0 = max(-b - sq, 0.0);
    float t1 = -b + sq;
    float t = t0;
    for (int j = 0; j < 16; j++) {
      vec3 wp = ro + rd * t;
      vec3 lp = transpose(uRingMats[i]) * (wp - p);
      float d = sdTorusZ(lp, r, 1.5);
      if (d < 0.02) {
        tBest = min(tBest, t);
        break;
      }
      t += d * 0.75;
      if (t > t1) break;
    }
  }
  return tBest;
}

vec3 ringNormal(vec3 wp) {
  float minD = 1e5;
  vec3 normal = vec3(0, 1, 0);
  for (int i = 0; i < 8; i++) {
    if (uRingsPos[i].w <= 0.0) continue;
    vec3 p = uRingsPos[i].xyz;
    vec3 lp = transpose(uRingMats[i]) * (wp - p);
    float r = uRingsPos[i].w;
    float d = sdTorusZ(lp, r, 1.5);
    if (d < minD) {
      minD = d;
      vec2 xy = lp.xy;
      float lenXY = max(length(xy), 0.001);
      vec3 nloc = normalize(vec3(xy.x, xy.y, 0.0) * (lenXY - r) / lenXY + vec3(0.0, 0.0, lp.z));
      normal = uRingMats[i] * nloc;
    }
  }
  return normal;
}

// ---------- alien fleet (v9.0) ----------
// Ships are BOX-CROPPED rectangular mandelboxes: the fractal is evaluated in
// a unit-cube domain and intersected with the exact ship box, so the
// silhouette is guaranteed (any aspect ratio works) while the mandelbox
// carves the hull detail. Fold/clamp math only — no trig — and every ship is
// gated by a ray/box test, so rays that miss pay almost nothing.
float mandelboxDE(vec3 p) {
  vec3 q = p;
  float dr = 1.0;
  float fixR2 = 1.0, minR2 = uBoxParam.y;
  for (int i = 0; i < 8; i++) {
    q = clamp(q, -uBoxParam.z, uBoxParam.z) * 2.0 - q;   // box fold
    float r2 = dot(q, q);
    if (r2 < minR2) { float f = fixR2 / minR2; q *= f; dr *= f; }
    else if (r2 < fixR2) { float f = fixR2 / r2; q *= f; dr *= f; }
    q = q * uBoxParam.x + p;
    dr = dr * abs(uBoxParam.x) + 1.0;
  }
  return length(q) / abs(dr);
}

float shipDE(vec3 l, vec3 h) {  // l = local coords, h = half extents
  float hmin = min(h.x, min(h.y, h.z));
  float mb = mandelboxDE(l / h * 1.15) / 1.15 * hmin;   // conservative for the stretch
  // Rounded corners for free: shrink the box by r, then add r back to the
  // distance. Same outer dimensions, an r-radius fillet on every edge. This
  // only works because sdBox above is the EXACT box SDF -- the cheap
  // max-of-components version cannot be offset like this. At uBoxRound = 0
  // it reduces to sdBox(l, h) exactly, so sharp stays bit-identical.
  float r = min(uBoxRound * hmin, hmin * 0.98);
  return max(sdBox(l, h - r) - r, mb);
}

float mandelbulbDE(vec3 p) {    // unit bulb, radius ~1.2
  vec3 z = p;
  float dr = 1.0, r = 0.0;
  float pw = uBoxParam.w;
  for (int i = 0; i < 7; i++) {
    r = length(z);
    if (r > 2.0) break;
    float th = acos(clamp(z.z / max(r, 1e-6), -1.0, 1.0)) * pw;
    float ph = atan(z.y, z.x) * pw;
    float zr = pow(r, pw);
    dr = pow(r, pw - 1.0) * pw * dr + 1.0;
    z = zr * vec3(sin(th) * cos(ph), sin(th) * sin(ph), cos(th)) + p;
  }
  return 0.5 * log(max(r, 1e-6)) * r / dr;
}

vec3 shipLocal(vec3 wp, vec3 c, float ca, float sa) {
  vec3 o = wp - c;
  return vec3(o.x * ca - o.z * sa, o.y, o.x * sa + o.z * ca);
}

vec2 boxGate(vec3 lo, vec3 ld, vec3 h) {
  vec3 inv = 1.0 / (ld + vec3(1e-8));
  vec3 ta = (-h - lo) * inv, tb = (h - lo) * inv;
  vec3 tmin = min(ta, tb), tmax = max(ta, tb);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

// returns vec2(t, id): id 0 = mothership, 1..6 harvester, 7 = relay bulb
vec2 marchAliens(vec3 ro, vec3 rd) {
  float tBest = 1e9;
  float idBest = -1.0;
  // mothership (axis-aligned)
  if (uMotherPos.y > -9000.0) {
    vec3 lo = ro - uMotherPos;
    vec2 g = boxGate(lo, rd, uMotherHalf + 2.0);
    if (g.x < g.y && g.y > 0.0) {
      float t = max(g.x, 0.0);
      // Budget, not precision. A ray nearly TANGENT to the hull converges
      // geometrically slowly in sphere tracing, and the corner fillet made
      // tangency common: a flat face is tangent at one grazing angle, a 90 m
      // rounded edge is tangent across a whole BAND of angles -- which is
      // exactly what you fly through when you skim along the hull. Rays that
      // ran out returned a MISS, so the hull simply was not drawn there, and
      // the surviving slivers between them read as horns.
      //
      // Measured on 1939 rays through that band (0.02..3 deg, camera 13 m off
      // the top face). Misses: 48 iters 18.8%, 192 8.6%, 384 1.3%, 768 0%.
      // The AVERAGE plateaus at ~42.6 whatever the cap, because nearly every
      // ray converges on its own -- the cap only serves the rare tangent one,
      // which is why 8x the ceiling costs ~3x the average and nothing near it
      // in the common case.
      //
      // And do NOT add step relaxation here. It was the obvious fix and it is
      // measurably WRONG: 0.55 relax made misses worse at the same cap (390 vs
      // 365) because the failure is budget, not overshoot -- the shipped march
      // already agreed with a 0.35-relax reference to ~1 m wherever it
      // converged. Relaxation just spends iterations to arrive slower.
      for (int i = 0; i < 384; i++) {
        float d = shipDE(lo + rd * t, uMotherHalf);
        if (d < 0.5 + t * 0.001) { if (t < tBest) { tBest = t; idBest = 0.0; } break; }
        t += d;
        if (t > g.y) break;
      }
    }
  }
  // harvesters
  for (int s = 0; s < 6; s++) {
    if (float(s) >= uShipN) break;
    if (uShipPos[s].y < -9000.0) continue;
    float ca = cos(uShipPos[s].w), sa = sin(uShipPos[s].w);
    vec3 lo = shipLocal(ro, uShipPos[s].xyz, ca, sa);
    vec3 ld = vec3(rd.x * ca - rd.z * sa, rd.y, rd.x * sa + rd.z * ca);
    vec2 g = boxGate(lo, ld, uShipHalf + 1.0);
    if (g.x < g.y && g.y > 0.0) {
      float t = max(g.x, 0.0);
      // same tangency budget as the mothership above -- harvesters are
      // smaller but their fillet is proportional, so the band is just as wide
      for (int i = 0; i < 384; i++) {
        float d = shipDE(lo + ld * t, uShipHalf);
        if (d < 0.15 + t * 0.001) { if (t < tBest) { tBest = t; idBest = 1.0 + float(s); } break; }
        t += d;
        if (t > g.y) break;
      }
    }
  }
  // relay bulb
  if (uRelay.y > -9000.0) {
    vec3 oc = ro - uRelay.xyz;
    float R = uRelay.w * 1.35;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - R * R;
    float disc = b * b - c;
    if (disc > 0.0) {
      float sq = sqrt(disc);
      float t = max(-b - sq, 0.0);
      float t1 = -b + sq;
      float S = uRelay.w / 1.2;
      for (int i = 0; i < 48; i++) {
        float d = mandelbulbDE((ro + rd * t - uRelay.xyz) / S) * S * 0.8;
        if (d < 0.05 + t * 0.001) { if (t < tBest) { tBest = t; idBest = 7.0; } break; }
        t += d;
        if (t > t1) break;
      }
    }
  }
  return vec2(tBest, idBest);
}

// numeric normal on whichever alien surface was hit
vec3 alienNormal(vec3 wp, float id) {
  vec2 e = vec2(0.35, 0.0);
  if (id > 6.5) {
    float S = uRelay.w / 1.2;
    vec3 c = uRelay.xyz;
    #define BDE(P) (mandelbulbDE(((P) - c) / S) * S)
    return normalize(vec3(BDE(wp + e.xyy) - BDE(wp - e.xyy), BDE(wp + e.yxy) - BDE(wp - e.yxy), BDE(wp + e.yyx) - BDE(wp - e.yyx)));
    #undef BDE
  }
  vec3 c; vec3 h; float ca = 1.0, sa = 0.0;
  if (id < 0.5) { c = uMotherPos; h = uMotherHalf; }
  else {
    int s = int(id - 1.0);
    c = uShipPos[s].xyz; h = uShipHalf;
    ca = cos(uShipPos[s].w); sa = sin(uShipPos[s].w);
  }
  #define SDE(P) shipDE(shipLocal(P, c, ca, sa), h)
  vec3 n = normalize(vec3(SDE(wp + e.xyy) - SDE(wp - e.xyy), SDE(wp + e.yxy) - SDE(wp - e.yxy), SDE(wp + e.yyx) - SDE(wp - e.yyx)));
  #undef SDE
  return n;
}

// ---------- shadow pack (v7.6) ----------
// Three light-blockers beyond the terrain's own soft shadow, all gated by
// the tune-panel toggle. CRAFT: real — bounding-sphere test then a short SDF
// march, penumbra widening with distance so the shadow melts away at
// altitude. CLOUDS: analytic chord attenuation through each cluster's
// bounding sphere — soft cumulus shade that drifts with the wind for free.
// TREES: a smart fake — a soft blob under each LIVING tree, computed from
// the same hashes + harvest texture as the geometry (so popping a tree
// removes its shadow), offset along the sun direction.
float craftShadow(vec3 p, vec3 sun) {
  if (uShadows < 0.5) return 1.0;
  vec3 oc = p - uCraftPos;
  float b = dot(oc, sun);
  if (b > 0.0) return 1.0;                    // craft is not sunward of p
  float c = dot(oc, oc) - 36.0;               // r = 6: bounding + penumbra margin
  float disc = b * b - c;
  if (disc <= 0.0) return 1.0;
  float sq = sqrt(disc);
  float t1 = -b + sq;
  float t = max(-b - sq, 0.0);
  float res = 1.0;
  for (int i = 0; i < 12; i++) {
    float d = sdCraft(toCraftLocal(p + sun * t));
    res = min(res, 16.0 * d / max(t, 4.0));   // penumbra widens with distance
    if (res < 0.02 || t > t1) break;
    t += max(d, 0.08);
  }
  // altitude fade: physically the umbra of a 6 m craft survives for hundreds
  // of meters, but visually a dark blob from cruise height reads wrong —
  // full shadow below 60 m, melted away by 160 m
  float fade = 1.0 - smoothstep(60.0, 160.0, -b);
  return clamp(mix(1.0, res, fade), 0.0, 1.0);
}

float cloudShadow(vec3 p, vec3 sun) {
  if (uShadows < 0.5) return 1.0;
  float att = 1.0;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uCloudN) break;
    vec3 oc = p - uCloudPos[i].xyz;
    float r = uCloudPos[i].w;
    float b = dot(oc, sun);
    if (b > 0.0) continue;
    float c = dot(oc, oc) - r * r;
    float disc = b * b - c;
    if (disc <= 0.0) continue;
    float chord = 2.0 * sqrt(disc) / max(r, 1.0);      // 0..2: path through the sphere
    att *= 1.0 - 0.7 * smoothstep(0.15, 1.6, chord);   // dense core, wispy rim
    if (att < 0.2) break;
  }
  return max(att, 0.18);                               // skylight keeps shade readable
}

float treeShadow(vec3 p, vec3 sun) {
  if (uShadows < 0.5 || uFloraDens <= 0.001) return 1.0;
  if (p.y < 5.0 || p.y > 140.0) return 1.0;            // greenbelt only (matches plantEval)
  // walk back toward the sun to find candidate caster cells; 3x3 covers
  // every tree size and center jitter
  vec2 sunH = sun.xz / max(sun.y, 0.35);
  vec2 q = p.xz + sunH * (0.30 * uTreeSize);
  vec2 base = floor(q / FCELL) - 1.0;
  float att = 1.0;
  for (int cy = 0; cy < 3; cy++)
  for (int cx = 0; cx < 3; cx++) {
    vec2 cell = base + vec2(float(cx), float(cy));
    float rnd = hash(cell);
    if (rnd > uFloraDens) continue;                    // no plant here
    if (texelFetch(uCollected, ivec2(mod(cell, 512.0)), 0).r > 0.5) continue; // harvested
    float s = mix(1.6, uTreeSize, pow(hash(cell + 51.0), mix(5.0, 1.2, uTreeShare)));
    if (s < 3.0) continue;                             // ferns: too small to matter
    vec2 ctr = (cell + 0.5) * FCELL + (vec2(hash(cell + 13.0), hash(cell + 37.0)) - 0.5) * 12.0;
    vec2 sp = ctr - sunH * (0.55 * s);                 // where the crown's shade lands
    float dd = length(p.xz - sp) / (0.45 * s + 1.2);
    att *= 1.0 - 0.5 * (1.0 - smoothstep(0.55, 1.0, dd));
  }
  return att;
}

// probe payload encoders: height → 24-bit fixed point over [-80, 560],
// plant distance → 8 bits over [0, 40] m
vec4 encodeHeight(float gh) {
  float nn = clamp((gh + 80.0) / 640.0, 0.0, 1.0);
  float v = floor(nn * 16777215.0);
  return vec4(floor(v / 65536.0), floor(mod(v, 65536.0) / 256.0), mod(v, 256.0), 255.0) / 255.0;
}
vec4 encodePlantD(float dP) {
  return vec4(vec3(clamp(dP / 40.0, 0.0, 1.0)), 1.0);
}

void main() {
  // ---- collision probe (v1.5, widened v3.2/v3.3) ----
  // The bottom-left pixel row doesn't render the scene; it encodes, in the
  // SAME fp32 math that draws the world, answers for JS collision queries:
  //   px 0-1        terrain height / plant distance at the craft
  //   px 2+2i, 3+2i terrain height / plant distance at bullet slot i (8 slots)
  //   px 18..81     plant distance at blast-query cell j (bomb detonations)
  //   px 82..84     terrain height at bomb slot k (3 slots)
  // JS reads the row back each frame in one readPixels, so all collision
  // agrees with the rendered geometry bit-for-bit.
  if (gl_FragCoord.y < 1.0 && gl_FragCoord.x < 133.0) {
    int px = int(gl_FragCoord.x);
    if (px < 18) {
      vec3 pp = (px < 2) ? uCraftPos : uBulletPos[(px - 2) / 2];
      float gh = terrainShape(pp.xz);
      bool wantGround = (px < 2) ? (px == 0) : ((px - 2) % 2 == 0);
      if (wantGround) fragColor = encodeHeight(gh);
      else            fragColor = encodePlantD(plantEval(pp, pp.y - gh, 0.0).x / 0.45);
    } else if (px < 82) {
      // does this cell hold a living tree? probe 4 m above its own ground
      vec2 c = uBlastCell[px - 18];
      float gh = terrainShape(c);
      fragColor = encodePlantD(plantEval(vec3(c.x, gh + 4.0, c.y), 4.0, 0.0).x / 0.45);
    } else if (px < 85) {
      fragColor = encodeHeight(terrainShape(uBombPos[px - 82].xz));
    } else {
      // fx occlusion probe (v7.9): is this overlay particle (contrail dot,
      // tracer, bomb, blast ring) hidden behind terrain from the camera?
      // Marches the SAME terrainShape the pixels render, so overlay
      // visibility agrees with the mountains bit-for-bit. Soft answer:
      // grazing a ridge fades instead of popping.
      vec3 pt = uFxPos[px - 85];
      vec3 dv = pt - uCamPos;
      float L = length(dv);
      float vis = 1.0;
      if (L > 25.0) {
        vec3 rd = dv / L;
        float t = 12.0;
        float mn = 1.0;
        for (int i = 0; i < 48; i++) {
          if (t > L - 10.0) break;
          vec3 p = uCamPos + rd * t;
          float h = p.y - terrainShape(p.xz);
          mn = min(mn, h / 10.0);
          if (mn < 0.0) break;
          t += max(h * 0.7, 10.0);
        }
        vis = clamp(mn, 0.0, 1.0);
      }
      fragColor = vec4(vis, vis, vis, 1.0);
    }
    return;
  }
  vec2 uv = (2.0 * (gl_FragCoord.xy + uJitter) - uResolution) / uResolution.y;
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamMat * vec3(uv * uFov, 1.0));
  vec3 sun = normalize(uSunDir);

  float marchIters;
  vec2 mres = marchTerrain(ro, rd, marchIters);
  float tT = mres.x;
  float tW = (rd.y < -1e-4 && ro.y > WATER_LEVEL) ? (WATER_LEVEL - ro.y) / rd.y : -1.0;
  float tC = marchCraft(ro, rd);
  float tR = marchRings(ro, rd);
  vec2 mal = marchAliens(ro, rd);

  float t = T_MAX;
  int mat = 0;                                              // 0 sky
  if (tT > 0.0 && tT < t) { t = tT; mat = int(mres.y); }    // 1 terrain / 4 plant
  if (tW > 0.0 && tW < t) { t = tW; mat = 2; }              // water
  if (tC > 0.0 && tC < t) { t = tC; mat = 3; }              // aircraft
  if (tR > 0.0 && tR < t) { t = tR; mat = 5; }              // score ring
  if (mal.y > -0.5 && mal.x < t) { t = mal.x; mat = 6; }    // alien fleet

  vec3 col;

  if (mat == 0) {
    col = skyColor(rd, sun);

  } else if (mat == 1) {
    vec3 pos = ro + rd * t;
    float px = t * uPixScale;
    vec3 n = terrainNormal(pos.xz, px);
    vec3 alb = terrainColor(pos, n, pos.y, px);
    float ndl = clamp(dot(n, sun), 0.0, 1.0);
    float sh = (ndl > 0.02) ? softShadow(pos + n * 1.0, sun) * craftShadow(pos, sun) * cloudShadow(pos, sun) * treeShadow(pos, sun) : 0.0; // + v7.6 shadow pack
    float dif = ndl * sh;
    float skyA = clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
    float bnc = clamp(dot(n, normalize(vec3(-sun.x, 0.0, -sun.z))), 0.0, 1.0);
    vec3 lin = sunLightCol(sun) * 2.3 * dif
             + skyAmbCol(sun) * 0.50 * skyA
             + vec3(0.90, 0.60, 0.40) * 0.12 * bnc;
    col = alb * lin;
    // low-sun sparkle on snow
    float snowy = smoothstep(uSnowLine, uSnowLine + 50.0, pos.y) * n.y;
    vec3 hlf = normalize(sun - rd);
    col += vec3(1.0, 0.9, 0.7) * pow(clamp(dot(n, hlf), 0.0, 1.0), 48.0) * snowy * sh * 0.6;
    col = applyFog(col, ro, rd, t, sun);

  } else if (mat == 2) {
    vec3 pos = ro + rd * t;
    float bed = terrainShapeLOD(pos.xz, t * uPixScale * uDetailFade);
    float depth = clamp((WATER_LEVEL - bed) / 8.0, 0.0, 1.0);
    // small animated ripples (rotated domain: wavelets off the world axes)
    vec2 wp = DECOR_ROT * pos.xz * 0.12;
    float w0 = noise(wp + uTime * 0.25);
    float wx = noise(wp + vec2(0.6, 0.0) + uTime * 0.25) - w0;
    float wz = noise(wp + vec2(0.0, 0.6) + uTime * 0.25) - w0;
    // Footprint-aware ripples (v9.4 DIAGNOSTIC). The ripple normal is sampled
    // ONCE per pixel from an ~8.3 m wavelength field, so past a 4.2 m footprint
    // -- t = 2.6 km at 1707x876 -- it is undersampled. The footprint grows
    // smoothly with distance, so the aliasing is radially symmetric: concentric
    // moire rings centred on the viewer, on water. A1 faded the terrain octaves
    // and even the snow edge (see noiseLOD in terrainColor) but never touched
    // the water -- which is why the detail-fade slider does nothing to these,
    // and why supersampling only pushes the crossing out (2.6 -> 5.2 km).
    float wfoot = t * uPixScale;
    float wfade = mix(1.0, 1.0 - smoothstep(1.5, 6.0, wfoot), uWaterLOD);
    vec3 n = normalize(vec3(-wx * 1.6 * wfade, 1.0, -wz * 1.6 * wfade));
    vec3 rr = reflect(rd, n);
    rr.y = abs(rr.y);
    vec3 refl = skyColor(rr, sun);
    float fres = 0.03 + 0.97 * pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 5.0);
    vec3 base = mix(vec3(0.10, 0.30, 0.28), vec3(0.02, 0.10, 0.13), depth); // glacial teal
    float sh = softShadow(pos + vec3(0.0, 0.5, 0.0), sun) * craftShadow(pos, sun) * cloudShadow(pos, sun);
    col = mix(base, refl, fres);
    vec3 glint = mix(vec3(1.0, 0.80, 0.50), vec3(1.1, 0.45, 0.20), duskAmount(sun));
    // A razor-thin highlight riding an undersampled normal is a firefly
    // factory, so broaden it as the ripples flatten out. Reduces to the
    // original 260 exactly when uWaterLOD is 0.
    float gexp = mix(260.0, 30.0, 1.0 - wfade);
    col += glint * pow(clamp(dot(rr, sun), 0.0, 1.0), gexp) * 3.0 * fres * sh;
    col = applyFog(col, ro, rd, t, sun);

  } else if (mat == 4) {
    vec3 pos = ro + rd * t;
    // the same faded terrain the march used to find this plant, or the trunk
    // would be anchored to a surface a step or two away from the one drawn
    float dT = pos.y - terrainShapeLOD(pos.xz, t * uPixScale * uDetailFade);
    vec3 pe = plantEval(pos, dT, t);
    float rnd = pe.y, yn = pe.z;
    // ALIEN BLUES (v4.4): color keys off the tree's actual size — the same
    // hash + treeShare curve the SDF uses — so small ferns are deep navy and
    // the big ones turn light fluo cyan.
    vec2 cell = floor(pos.xz / FCELL);
    float sn = pow(hash(cell + 51.0), mix(5.0, 1.2, uTreeShare));   // 0 small → 1 big
    vec3 alb = mix(vec3(0.020, 0.055, 0.20), vec3(0.24, 0.66, 1.02), sn);
    alb *= 0.88 + 0.24 * fract(rnd * 7.31);            // slight per-tree variation
    alb *= 0.72 + 0.55 * yn;                           // brighter toward the tips
    // cheap cone normal: radial from the plant axis + upward bias
    vec2 ctr = (cell + 0.5) * FCELL + (vec2(hash(cell + 13.0), hash(cell + 37.0)) - 0.5) * 12.0;
    vec3 n = normalize(vec3(pos.x - ctr.x, 2.4, pos.z - ctr.y));
    float ndl = clamp(dot(n, sun), 0.0, 1.0);
    float sh = (ndl > 0.02) ? softShadow(pos + vec3(0.0, 1.2, 0.0), sun) * craftShadow(pos, sun) * cloudShadow(pos, sun) : 0.0;
    vec3 lin = sunLightCol(sun) * 2.0 * ndl * sh
             + skyAmbCol(sun) * 0.55 * clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
    col = alb * lin;
    // glow-in-the-dark: an unlit emissive that scales with size (big = more
    // glow) and height on the plant, and INTENSIFIES at dusk. Part is added
    // after the fog so distant groves still shine through the haze.
    float glow = mix(0.05, 0.60, sn) * (0.40 + 0.60 * yn) * (0.7 + 1.2 * duskAmount(sun));
    vec3 glowC = mix(vec3(0.08, 0.30, 0.85), vec3(0.30, 0.85, 1.15), sn);
    col += glowC * glow * 0.7;
    col += glowC * smoothstep(0.82, 1.0, yn) * (0.25 + 0.55 * sn);   // luminous frond tips
    col = applyFog(col, ro, rd, t, sun);
    col += glowC * glow * 0.3;                         // post-fog: shines through haze

  } else if (mat == 5) {
    vec3 pos = ro + rd * t;
    vec3 n = ringNormal(pos);
    vec3 lp = vec3(0.0);
    float minD = 1e5;
    for (int i = 0; i < 8; i++) {
      if (uRingsPos[i].w <= 0.0) continue;
      vec3 p = uRingsPos[i].xyz;
      vec3 l = transpose(uRingMats[i]) * (pos - p);
      float r = uRingsPos[i].w;
      float d = sdTorusZ(l, r, 1.5);
      if (d < minD) { minD = d; lp = l; }
    }
    float angle = atan(lp.y, lp.x);
    float stripe = step(0.0, sin(angle * 8.0 + uTime * 6.0));
    vec3 alb = mix(vec3(1.0, 0.85, 0.2), vec3(0.9, 0.5, 0.0), stripe * 0.6);
    float sh = softShadow(pos + n * 0.5, sun) * cloudShadow(pos, sun);
    float dif = clamp(dot(n, sun), 0.0, 1.0) * sh;
    float skyA = clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
    vec3 lin = sunLightCol(sun) * 1.5 * dif + skyAmbCol(sun) * 0.6 * skyA;
    vec3 hlf = normalize(sun - rd);
    float spec = pow(clamp(dot(n, hlf), 0.0, 1.0), 32.0);
    col = alb * lin + vec3(1.0, 0.9, 0.7) * spec * sh;
    float rim = 1.0 - max(dot(n, -rd), 0.0);
    col += vec3(1.0, 0.6, 0.1) * pow(rim, 2.0) * 0.8;
    col += alb * 0.4;
    col = applyFog(col, ro, rd, t, sun);

  } else if (mat == 6) {
    // alien hull: dark blue-steel metal, pulsing cyan-blue seams, deep blue
    // glow for the relay bulb; melting ships stay molten orange -- now the
    // only warm thing on a hull, so damage reads at a glance
    vec3 pos = ro + rd * t;
    vec3 n = alienNormal(pos, mal.y);
    float melt = (mal.y < 0.5) ? uMotherMelt : (mal.y > 6.5 ? uRelayMelt : uShipMelt[int(mal.y - 1.0)]);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
    float dif = clamp(dot(n, sun), 0.0, 1.0) * cloudShadow(pos, sun);
    // bio-organic hull (v9.1): dendritic Julia filaments + fbm mottling in
    // the ship's LOCAL frame — no world-aligned stripes, no moiré (the
    // pattern fades to a plain glow with distance instead of aliasing)
    vec3 lp;
    float sizeRef;
    if (mal.y < 0.5) { lp = pos - uMotherPos; sizeRef = uMotherHalf.z; }
    else if (mal.y > 6.5) { lp = pos - uRelay.xyz; sizeRef = uRelay.w * 2.0; }
    else {
      int si = int(mal.y - 1.0);
      float ca2 = cos(uShipPos[si].w), sa2 = sin(uShipPos[si].w);
      lp = shipLocal(pos, uShipPos[si].xyz, ca2, sa2);
      sizeRef = uShipHalf.x;
    }
    float oScale = 84.0 / max(sizeRef, 1.0);
    float detail = 1.0 - smoothstep(1200.0, 4000.0, t);
    float org = (detail > 0.01) ? alienFlora(vec2(lp.x + lp.y * 0.6, lp.z - lp.y * 0.45) * oScale) : 0.35;
    float mott = fbm(lp.xz * (oScale * 0.05) + lp.y * 0.02, 3);
    vec3 alb = mix(vec3(0.040, 0.062, 0.105), vec3(0.115, 0.180, 0.300), fres) * (0.7 + 0.5 * mott);
    col = alb * (sunLightCol(sun) * 1.4 * dif + skyAmbCol(sun) * 0.5);
    vec3 glowC = (mal.y > 6.5) ? vec3(0.25, 0.72, 1.35) : vec3(0.14, 0.62, 1.15);
    float vein = pow(clamp(org, 0.0, 1.0), 2.0);
    col += glowC * vein * (0.5 + 0.25 * sin(uTime * 2.0 + org * 9.0)) * (0.35 + 0.65 * detail);
    col += glowC * fres * 0.22;
    if (mal.y > 6.5) col += vec3(0.18, 0.50, 1.20) * (0.3 + 0.25 * sin(uTime * 3.0)) * fres;
    // bomb hit: this hull flares cold white-blue for a beat. One vec2 for the
    // whole fleet rather than a per-hull array -- the uniform budget is already
    // over the 224-slot mobile minimum (see CLAUDE.md), and two bombs landing
    // on two different hulls inside the same flash window is not a real case.
    float hitF = (abs(uAlienHit.x - mal.y) < 0.5) ? uAlienHit.y : 0.0;
    col = mix(col, vec3(0.72, 0.86, 1.15), hitF * 0.30);
    col += vec3(0.16, 0.40, 0.85) * hitF * (0.22 + fres * 0.6);
    // Melt colour. Up to MELT_KNEE the wreck is molten and PULSES. Past the
    // knee -- the ~110 s tail where it just lies there -- the pulse dies out
    // and it settles to dark red-orange embers. A wreck that blinks for two
    // minutes reads as something still alive; a dead one should go quiet.
    float mk = clamp((melt - MELT_KNEE) / (1.0 - MELT_KNEE), 0.0, 1.0);
    vec3 molten = vec3(1.2, 0.45, 0.08) * (1.2 + 0.5 * sin(uTime * 7.0));
    vec3 embers = vec3(0.26, 0.055, 0.018);
    col = mix(col, mix(molten, embers, mk), clamp(melt, 0.0, 1.0) * 0.8);
    col = applyFog(col, ro, rd, t, sun);

  } else {
    vec3 pos = ro + rd * t;
    vec3 n = craftNormal(pos);
    vec3 lp = toCraftLocal(pos);
    // livery: white body, signal-red nose / wingtips / fin
    vec3 alb = vec3(0.88, 0.89, 0.92);
    float red = clamp(step(1.65, lp.z) + step(2.55, abs(lp.x)) + ((lp.y > 0.35 && lp.z < -1.6) ? 1.0 : 0.0), 0.0, 1.0);
    alb = mix(alb, uLivery, red);
    float sh = softShadow(pos, sun) * cloudShadow(pos, sun);
    float dif = clamp(dot(n, sun), 0.0, 1.0) * sh;
    float skyA = clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
    vec3 lin = sunLightCol(sun) * 2.2 * dif + skyAmbCol(sun) * 0.55 * skyA;
    vec3 hlf = normalize(sun - rd);
    col = alb * lin + vec3(1.0, 0.9, 0.75) * pow(clamp(dot(n, hlf), 0.0, 1.0), 60.0) * sh * 0.8;
    col = applyFog(col, ro, rd, t, sun);
  }

  // alien harvest lasers (v9.0): a translucent cyan-blue SHEET spanning the
  // ship's full length, dropping to the terrain — brightest at ground contact
  for (int s = 0; s < 6; s++) {
    if (float(s) >= uShipN || uShipLaser[s] < 0.5) continue;
    float ca = cos(uShipPos[s].w), sa = sin(uShipPos[s].w);
    vec3 n = vec3(sa, 0.0, ca);                 // sheet normal = heading direction
    float den = dot(rd, n);
    if (abs(den) < 1e-4) continue;
    float tp = dot(uShipPos[s].xyz - ro, n) / den;
    if (tp < 0.0 || tp > t) continue;
    vec3 hp = ro + rd * tp;
    vec3 rel = hp - uShipPos[s].xyz;
    float lx = rel.x * ca - rel.z * sa;         // along the long axis
    if (abs(lx) > uShipHalf.x) continue;
    if (hp.y > uShipPos[s].y - uShipHalf.y * 0.4) continue;
    float gy = terrainShape(hp.xz);
    if (hp.y < gy - 1.0) continue;
    float pulse = 0.7 + 0.3 * sin(uTime * 9.0 + lx * 0.06);
    float edge = smoothstep(uShipHalf.x, uShipHalf.x * 0.9, abs(lx));
    float ground = 1.0 + 2.6 * exp(-(hp.y - gy) * 0.12);
    col += vec3(0.30, 0.85, 1.0) * 0.14 * pulse * edge * ground;
  }

  // alien energy beams: harvester -> relay, then relay -> mothership.
  //
  // These used to be 2D lines on the fx overlay, which has no depth buffer, so
  // a beam crossing behind a ridge was still painted over it. Here in the
  // marcher the closest-approach distance along the ray is compared against the
  // primary hit distance t, which occludes them against terrain, hulls and trees
  // for free -- the same trick the harvest sheet above already used.
  //
  // Only (source, head, tail, fade) is uploaded; the ENDPOINTS are read from
  // uShipPos / uRelay / uMotherPos, which cost nothing extra and keep a beam
  // welded to a harvester that is still moving.
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uBoltN) break;
    vec4 bv = uBolts[i];
    int sid = int(bv.x + 0.5);
    bool big = sid > 5;
    vec3 p0 = big ? uRelay.xyz : uShipPos[sid].xyz;
    vec3 p1 = big ? uMotherPos : uRelay.xyz;
    vec3 ba = mix(p0, p1, bv.z), bb = mix(p0, p1, bv.y);
    vec3 sg = bb - ba;
    float cc = dot(sg, sg);
    if (cc < 1.0) continue;
    // closest approach between the view ray and the beam segment
    vec3 w0 = ro - ba;
    float Bc = dot(rd, sg), Dc = dot(rd, w0), Ec = dot(sg, w0);
    float den = cc - Bc * Bc;
    float u = (abs(den) < 1e-5) ? clamp(-Ec / cc, 0.0, 1.0)
                                : clamp((Ec - Bc * Dc) / den, 0.0, 1.0);
    float sray = -Dc + u * Bc;
    if (sray < 0.0 || sray > t) continue;      // behind the camera, or behind the world
    float dist = length(ro + rd * sray - (ba + sg * u));
    float wid = big ? 26.0 : 11.0;
    float halo = exp(-dist * dist / (wid * wid));
    float core = exp(-dist * dist / (wid * wid * 0.10));
    vec3 bcol = big ? vec3(0.55, 0.82, 1.0) : vec3(0.22, 0.60, 1.0);
    col += bcol * (halo * 0.45 + core * 1.7) * bv.w;
  }

  // cumulonimbus over everything nearer than the hit (or the whole sky)
  if (uCloudN > 0.5) {
    vec4 cld = cloudLayer(ro, rd, (mat == 0) ? T_MAX : t, sun);
    col = mix(col, cld.rgb, cld.a);
  }

  // filmic-ish tonemap + gamma + gentle vignette
  // ---- DIAGNOSTIC CHANNELS (v9.4) ----------------------------------------
  // Six independent toggles, summed, each in its own hue -- so two channels
  // enabled together show where their bands REGISTER (hues add) and where they
  // beat against each other.
  //
  // Worth knowing while reading them: these are not six independent things.
  // The march produces t; pixelSize is just t * uPixScale; and height/normal/
  // colour all derive from those. So "hit distance" and "pixel footprint" are
  // the SAME quantity at different band widths, and "terrain height" is
  // world-locked. The artifact lives wherever a CONSUMER of t has a sharp
  // threshold -- which is what channel 32 exists to show.
  //
  //   1 march steps   2 hit distance   4 pixel footprint
  //   8 terrain height (world-locked)  16 normal turn across a footprint
  //  64 march budget (ramp; white = exhausted the 384 cap)
  //  32 colour LOD -- the alien-undergrowth fade, smoothstep(3,5,pixelSize),
  //     i.e. a hard viewer-centred ring on the green at t = 1875..3125 m
  int dmask = int(uDebugMask + 0.5);
  if (dmask > 0) {
    vec3 hp = ro + rd * t;
    vec3 d = vec3(0.0);
    float nch = 0.0;
    if ((dmask & 1) != 0) {
      d += vec3(1.0, 0.25, 0.25) * fract(marchIters / 12.0);          nch += 1.0;
    }
    if ((dmask & 2) != 0) {
      d += vec3(0.25, 1.0, 0.25) * fract(t / 250.0);                  nch += 1.0;
    }
    if ((dmask & 4) != 0) {
      d += vec3(0.30, 0.45, 1.0) * fract(t * uPixScale);              nch += 1.0;
    }
    if ((dmask & 8) != 0) {
      d += vec3(1.0, 1.0, 0.35) * fract(terrainShape(hp.xz) / 4.0);   nch += 1.0;
    }
    if ((dmask & 16) != 0) {
      float turn = length(terrainNormal(hp.xz, t * uPixScale) - terrainNormal(hp.xz, 0.15));
      d += vec3(1.0, 0.35, 1.0) * clamp(turn * 4.0, 0.0, 1.0);        nch += 1.0;
    }
    if ((dmask & 32) != 0) {
      // exactly the term terrainColor uses to fade the undergrowth out
      float cl = 1.0 - smoothstep(3.0, 5.0, t * uPixScale);
      d += vec3(0.35, 1.0, 1.0) * cl;                                 nch += 1.0;
    }
    if ((dmask & 64) != 0) {
      // v9.5: iterations spent, as a ramp; a ray that hit the 384 cap is WHITE.
      // The old 'march steps' sawtooth could not tell 150 from 6.
      float bud = marchIters / 384.0;
      d += (marchIters >= 383.0) ? vec3(3.0) : vec3(1.0, 0.30, 0.10) * bud;   nch += 1.0;
    }
    col = d / max(nch, 1.0);
    if (mat == 0) col = vec3(0.02);          // leave the sky dark
  }
  col = 1.0 - exp(-col * 1.15);
  col = pow(col, vec3(0.4545));
  vec2 vuv = gl_FragCoord.xy / uResolution;
  col *= 0.35 + 0.65 * pow(16.0 * vuv.x * vuv.y * (1.0 - vuv.x) * (1.0 - vuv.y), 0.20);

  fragColor = vec4(col, 1.0);
}`;
