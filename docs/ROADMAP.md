# Roadmap (drafted after the terrain/shimmer research session)

## ▶ NEXT SESSION — START HERE (work queue, in order)

0. **Run `node test/run_tests.js` first.** It should print "all suites
   passed". Then `python serve.py 8734` and fly it once.
1. Read docs/HISTORY.md once (the WHY archive) and **docs/RESEARCH.md
   before touching sections A or B** — it holds the full shimmer diagnosis
   (7 causes), the reasoning behind each fix, the paper analyses, the
   TerraForge findings, and the Mandelbox parameter guide.
2. **C1 — single-file build script. NOW THE MOST URGENT ITEM.** Generate the
   single-file build from the modules (inline css, concat js in dependency
   order, strip import/export, reconcile the few divergent identifiers — see
   CLAUDE.md Gotchas). Verify by diffing behavior against
   `fractal-flight-v9_1b.html` (the last hand-maintained single build).
   From then on the single file is a build ARTIFACT — never edit it.
   * ⚠️ **The single file is STALE as of 6 Sept 2026 and Nico accepted that
     knowingly** ("yes accept the difference, C1 will regenerate it"). It is
     missing: the tuning-panel overflow fix + COPY JSON export
     (`css/style.css`, `js/tune.js`), the tuned world/fleet defaults and
     raised ceilings (`js/tune.js`), the bomb-count constants and
     `hullAlive` (`js/aliens.js`), and the `camPos` → `viewPos` freeze fix
     (`js/fx.js`). Do NOT hand-patch those in — regenerate.
   * Concatenation order, derived from the imports and verified acyclic:
     config · math · state · tune · shaders · renderer · audio · terrain ·
     fx · spores · weapons · clouds · rings · hud · aliens · input · flight ·
     main.
   * ⛔ The v9.1b single file has `camPos` as a real global in 20 places. The
     generator must NOT simply concatenate and hope — `test/
     check_module_refs.py` passing on the modules is what makes the concat
     safe, so run it as part of the build.
3. **A1 — footprint-aware detail fade** (the shimmer killer, details in
   section A below). Verify: fly at altitude, ground sparkle and silhouette
   crawl visibly reduced; fps same or better.
4. **A2 + A3 — specular softening + shoreline band** (small, do together).
5. **C2 — port the Node test harnesses into test/** (do opportunistically
   while touching flight/rings/aliens).
6. **B2 — TerraForge3D biome ports** (mesas + canyons first, MIT
   attribution in README), then **B1 — multifractal octaves**.
7. Push the branch, update the PR to julaub — it's been a long volley.
   Nothing has been pushed since v8.0: branch `v9.1` holds the whole
   v8.1→v9.1b line plus this session's work, and `v7.0` still points exactly
   at `origin/v7.0` so nothing jul has seen has moved.

Working conventions: run `python serve.py 8734` for live testing (it sends
no-store — the bare http.server lets a refresh replay cached modules);
every flight/ring/alien change gets a Node harness check before commit;
keep the GLSL↔terrain.js mirror in sync (CLAUDE.md).

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
