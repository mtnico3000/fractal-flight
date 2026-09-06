# Roadmap (drafted after the terrain/shimmer research session)

## ▶ NEXT SESSION — START HERE (work queue, in order)

0. **Run `node test/run_tests.js` first.** It should print "all suites
   passed". Then `python serve.py 8734` and fly it once.
1. Read docs/HISTORY.md once (the WHY archive) and **docs/RESEARCH.md
   before touching sections A or B** — it holds the full shimmer diagnosis
   (7 causes), the reasoning behind each fix, the paper analyses, the
   TerraForge findings, and the Mandelbox parameter guide.
2. ✅ **C1 — single-file build script. DONE 6 Sept 2026.** `node build.js`
   generates `fractal-flight-v9_1.html` from the modules. **The single file is
   now a build ARTIFACT — never edit it.** `node test/run_tests.js` fails if
   the committed artifact is not byte-identical to what the current source
   produces, so it cannot drift again.
   * The concatenation order is DERIVED from the import graph (depth-first
     post-order = the browser's own module evaluation order), not the list
     that used to sit here — a hard-coded list works until someone adds an
     import. It comes out as: config · state · shaders · renderer · tune ·
     audio · terrain · fx · spores · weapons · hud · input · math · rings ·
     clouds · aliens · flight · main.
   * The bundle is wrapped in an IIFE with `'use strict'`, so the artifact no
     longer publishes ~200 globals the way the hand-built one did (`camPos`
     was a real global in 20 places there). `check_module_refs.py` runs as
     part of the build, which is what makes the concatenation safe.
   * All four gaps the stale v9.1b had are closed and were verified against
     it: the tuning-panel overflow fix + COPY JSON, the tuned world/fleet
     defaults and raised ceilings, the bomb constants + `hullAlive`, and the
     `camPos`→`viewPos` freeze fix.
   * Found on the way: `css/style.css` started with a literal `<style>` line,
     which CSS parses as an invalid rule that also eats the rule after it —
     **the universal reset had been dead in the modular build all along**
     (`content-box`, default heading margins, panels overflowing). Removed;
     the modular HUD layout changed visibly for the better.

3. ✅ **A1 — footprint-aware detail fade. DONE 6 Sept 2026.** Terrain and
   colour octaves now fade out as they cross Nyquist for the pixel's ground
   footprint, under a `detail fade` knob (0 = pre-A1 look, 1 = default,
   2 = aggressive). Measured on a locked camera by shifting `uJitter` half a
   pixel (method + numbers in docs/RESEARCH.md §3):
   * ground-filling view, near field: shimmer **−41% mean, −70% median**.
     That is the "ground sparkles" complaint, and it is fixed.
   * far field: only −3%. **59% of the energy out there is silhouette
     edges** — 10% of pixels flipping hit/miss — which A1 cannot touch by
     construction.
   * GPU throughput **+3%** (fade 1) / **+6%** (fade 2), cold shader compile
     unchanged. Compare Mpix/s, not fps: the adaptive render scaler reacts to
     fps and hides the effect.
   * fade 2 measures the same as fade 1 in the near/mid field — everything
     sub-pixel is already gone at 1 — so **1.0 is the right default** and 2 is
     only a knob for weak GPUs.
   * `terrainShape()` is unchanged (it is `terrainShapeLOD(p, 0.0)`), so the
     probe row and the terrain.js mirror still agree: CPU/GPU divergence
     measured at 0.04–0.31 m, the same fp32-vs-fp64 band as before A1.
     `test/test_shader.js` locks that invariant.
4. **A4 — silhouette stabilization. PROMOTED above A2/A3** by A1's
   measurements: it is now where essentially all the remaining shimmer lives
   (a few bisection refine steps at the hit, slower-growing hit tolerance).
   Then **A2 + A3 — specular softening + shoreline band** (small, do
   together, but not where the energy is).
5. **C2 — CONTINUE the suite** (started 6 Sept 2026; `node test/run_tests.js`
   is green with 29 assertions). Already covered: the alien bomb economy and
   hull states, the tuning-panel invariants, README/CLAUDE.md drift, the
   cross-module reference check, the single-file build's freshness, and the
   shader-source invariants that keep collision full-detail. **Still to port: GLSL parse via
   @shaderfrog/glsl-parser** (function-like #define macros produce ignorable
   warnings) **and a jsdom module-graph smoke load** (matchMedia needs a
   stub; do NOT override Node's `performance`). Both need dev dependencies,
   which is why they were left — `.gitignore` already covers node_modules.
   Keep adding opportunistically while touching flight/rings/aliens.
6. **B2 — TerraForge3D biome ports** (mesas + canyons first, MIT
   attribution in README), then **B1 — multifractal octaves**.
7. Push the branch, update the PR to julaub — it's been a long volley.
   Nothing has been pushed since v8.0: branch `v9.1` holds the whole
   v8.1→v9.1b line plus this session's work, and `v7.0` still points exactly
   at `origin/v7.0` so nothing jul has seen has moved.

Working conventions: run `python serve.py 8734` for live testing (it sends
no-store — the bare http.server lets a refresh replay cached modules);
**run `node build.js` and commit the artifact with any change to js/, css/ or
index.html** (the suite fails otherwise); every flight/ring/alien change gets
a Node harness check before commit; keep the GLSL↔terrain.js mirror in sync
(CLAUDE.md).

### Reference materials

- `docs/papers/paperftfractals.pdf` — van Lawick van Pabst & Jense,
  multifractal terrain (TNO). Feeds B1: α = singularity/peak density,
  C1 = sparseness, H = smoothing; their FFT pipeline is offline-only, use
  the Musgrave octave-coupling equivalent in-shader.
- `docs/papers/On_escape_criterion_of_an_orbit_with_s-convexity_a.pdf` —
  Alam et al., PLOS ONE 2025. Feeds B3: escape criteria for
  cos(u^m)+αu+β with s-convex orbits; use as 2D continent/flora MASKS only
  (no distance estimator exists → not raymarchable); s and α are morph
  sliders.
- TerraForge3D is NOT vendored here — clone when starting B2:
  `git clone --depth 1 -b gen3 https://github.com/Jaysmito101/TerraForge3D`
  → `Binaries/Data/shaders/generation/base_shape/*/shape.glsl` (mesas and
  canyons are the best starting ports; ~30 lines each, fbm+mask style,
  compatible with our analytic terrainShape). MIT license — keep the
  copyright notice (Jaysmito Mukherjee) in README when porting code. Their
  erosion/denoise filters are heightmap raster passes — NOT portable to
  our analytic terrain (only relevant if we ever do the B4 hybrid baking).

---

Ordered by value-per-effort within each theme. Effort: S (<half day),
M (a day-ish), L (multi-day / architectural).

## A. Image stability — kill the shimmer

The world sparkles and silhouettes crawl because we shoot ONE ray per pixel
at a surface with detail far beyond Nyquist, with no AA of any kind
(uJitter is locked to 0), a hit tolerance that grows with distance
(`0.01 + 0.0015·t`), binary material decisions at the shoreline, and a
`pow(…, 260)` sun glint (specular fireflies). Fix ladder:

1. **Footprint-aware detail fade (S/M, do first).** Scale fbm octave count /
   amplitude and the color-detail frequencies (rock strata, alienFlora
   undergrowth, snow masks) by the pixel's ground footprint (`uPixScale·t`).
   Analytic mipmapping: removes most ground sparkle AND reduces GPU cost.
   Mirror-sensitive: terrainShape only (terrain.js mirror keeps full detail —
   gameplay queries want the true surface).
2. **Soften the razors (S).** Distance-lower the water glint exponent,
   flatten water/snow normals at range, clamp specular.
3. **Shoreline band (S).** Blend water/terrain shading over a small
   `|h − WATER_LEVEL|` band scaled by footprint instead of the binary
   mat 1/2 pick.
4. **Silhouette stabilization (S).** A few bisection steps at hit refine;
   slower-growing hit tolerance. Helps mountain tops and tree contours.
5. **Still-camera accumulation (M).** When view+craft are ~static (esp.
   OBSERVATION mode), jitter uJitter and average frames in an FBO —
   converges to a perfectly antialiased frame in ~0.5 s; falls back to
   current behavior in motion. Pairs with: lock renderScale while in O mode.
6. **Full TAA with reprojection (L, the gold standard).** Needs history
   texture + per-pixel depth output (we march anyway — write t to a second
   attachment), Halton uJitter, neighborhood clamp. Watch ghosting on the
   craft/rings/bolts.

## B. Terrain variety

1. **Multifractal octave coupling (S).** Weight each fbm octave by the
   signal accumulated so far (Musgrave-style) instead of fixed 0.5 gain —
   valleys smooth, ridges jagged, one multiply per octave. Add a slider
   (the paper's α-analog). Mirror in terrain.js.
2. **TerraForge3D biome ports (M).** gen3 `generation/base_shape/*` is MIT
   (attribution required): mesas, canyons, karst, dunes, terraces, craters,
   volcano — each ~30 lines of fbm+mask math directly compatible with our
   analytic terrainShape. Add a low-frequency biome selector field blending
   1-2 shapes per region into the smax composition; gate evaluation by
   selector so each point pays only its local biome. Mirror in terrain.js.
3. **cos-type world masks (M).** From the s-convexity escape-criterion
   paper: iterate cos(u^m)+αu+β as the CONTINENT MASK (the role z²+c plays
   today) → alien coastlines; expose s/α as morph sliders. 2D masks only —
   no distance estimator exists for raymarching these in 3D. Same trick can
   re-skin alienFlora.
4. **Hybrid baking (L, only if needed).** Tile the macro terrain into a
   heightmap texture (keep analytic micro-detail on top): one fetch replaces
   two mandelDE evals (net speedup) and unlocks raster erosion filters à la
   TerraForge — at the cost of the pure-analytic architecture.

## C. Engineering

1. **Single-file build script (S, FIRST TASK in Claude Code).** Generate
   `fractal-flight-single.html` from the modules (inline css + concat js in
   dependency order, strip import/export, rename the few divergent
   identifiers). Ends the dual-build maintenance that caused repeated
   patch-drift bugs.
2. **Port the Node test harnesses (S/M)** from the Cowork sessions into
   `test/` with npm scripts (flight modes, rings, aliens economy, GLSL parse
   via @shaderfrog/glsl-parser, jsdom module-graph smoke).
3. **Uniform budget check (S).** ~260 vec4 slots used; verify link on
   weakest target (jul's phone). If tight: pack alien ship data into a
   texture instead of uniforms.
4. **GitHub Pages deploy (S).** Playable URL for the ping-pong, no local
   server.

## D. Parking lot (discussed, not committed)

- Mandelbulb/Mandelbox flyable landmark variants (negative-scale organic
  family is the visual gold: boxScale ≈ −1.5…−2.8).
- Alien counterplay escalation (harvesters reacting to being bombed).
- Multiplayer-ish: pilot-name livery already persists; ghosts someday?
