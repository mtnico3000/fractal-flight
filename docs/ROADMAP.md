# Roadmap (drafted after the terrain/shimmer research session)

## ⏸ BLOCKED ON HARDWARE — read this first (8 Sept 2026)

**The barrel AC adapter is dead. Resume the graphics work when Nico says a
new one has arrived.** Diagnosed by elimination on 8 Sept 2026:

| evidence | reading |
|---|---|
| barrel adapter connected | `PowerLineStatus: Offline` — no AC seen at all |
| after a full EC reset (shutdown, 40 s power-button hold, 10 min unplugged) | charge LED never lit |
| **USB-C PD connected** | `PowerLineStatus: Online`, **charging at 24.6 W** |
| ACPI "Microsoft AC Adapter" device | present, status **OK** |
| battery health | 67 812 / 90 001 mWh (75 %), fine |

USB-C charging works, so the EC, the charging circuit and the battery are
all healthy — **only the barrel adapter is broken.** (A charge LIMIT would
read "plugged in, not charging"; "Offline" means no adapter at all.)

**Why this blocks the graphics work:** on battery the RTX 4090 is pinned at
its idle P-state. Measured under sustained load: **146/150 samples at P8,
210 MHz, 5.5 W**, against a card maximum of 3105 MHz / 150 W — roughly 7 %
of clock on 4 % of power. USB-C PD flips PowerLineStatus to Online but only
delivers ~25 W, which cannot feed a 150 W GPU, so it is not a substitute for
proper testing.

**When the adapter is back, resume in this order:**
1. `nvidia-smi --query-gpu=pstate,clocks.sm,power.draw --format=csv` while
   the game runs. Expect it to leave P8. If it does not, set NVIDIA Control
   Panel > Manage 3D settings > Power management mode > Prefer maximum
   performance.
2. G-Helper `performance_mode` is **2 = Silent** with power limits of 80 —
   switch to Balanced/Turbo before judging frame rates.
3. Chrome must be forced onto the dGPU; `powerPreference:
   'high-performance'` in renderer.js is NOT enough on this laptop. One-off:
   `chrome.exe --user-data-dir=<temp> --force-high-performance-gpu <url>`.
4. Re-test the periodic hiccup. It appeared ONLY on the RTX (never on the
   iGPU), on both the A1 and v9.1 builds, and **went away after a reboot** —
   consistent with a driver clock/power-state transition rather than
   anything in the game. Frame-time sampling found zero spikes above 1.8x
   median, and the only teleport in the world state was jul's ring recycler
   (a ring moves ~4 km on a ~4 s cadence, `js/rings.js`, untouched by any
   A-commit).

---

## ▶ NEXT SESSION — START HERE (work queue, in order)

**Branch `v9.2` is the mainline** (`main` points at it). It branches from A1;
A2–A6 were built, measured and dropped — see below before rebuilding any of
them.

0. **Run `node test/run_tests.js` first.** It should print "all suites
   passed" (32 assertions, 6 files). Then `python serve.py 8734`, press
   START, and fly it once.
1. Read docs/HISTORY.md once (the WHY archive). **Before touching graphics,
   read docs/RESEARCH.md §3** — in particular the entry explaining that the
   whole shimmer hunt was answering the wrong question.

2. ▶ **C2 — CONTINUE the test suite. THIS IS THE NEXT ITEM.**
   `node test/run_tests.js` is green with **32 assertions across 6 files**:
   `test_aliens.js` (bomb economy, hull states), `test_tune.js` (knob
   invariants), `test_build.js` (the artifact is byte-identical to what
   build.js generates), `test_shader.js` (terrainShape is still the px=0
   collision authority), `test_render.js` (fps stat uses rawDt; a pinned
   resolution beats the auto-scaler), `test_docs.js` (README/CLAUDE.md
   drift), plus `check_module_refs.py`.
   * **Still to port, both needing dev dependencies** (`.gitignore` already
     covers `node_modules`, which is why they were left):
     - **GLSL parse via `@shaderfrog/glsl-parser`** — function-like `#define`
       macros produce warnings that can be ignored. This would finally let
       `test_shader.js` check the shader as CODE rather than by regex.
     - **A jsdom module-graph smoke load** — stub `matchMedia`; do NOT
       override Node's `performance`.
   * Keep adding opportunistically while touching flight/rings/aliens.

3. **B2 — TerraForge3D biome ports** (mesas + canyons first, MIT attribution
   for Jaysmito Mukherjee in the README), then **B1 — multifractal octaves**
   (Musgrave-style octave coupling + a slider; mirror in terrain.js).

4. **Push the branch and update the PR to julaub.** `main`/`v9.2` is **13+
   commits ahead of `origin/main`** and nothing has been pushed since v8.0.
   `origin` is Nico's own fork (mtnico3000); PRs go to julaub. Ask before
   pushing — it is a volley.

### ⏸ Parked, with reasons

- **GPU / adapter warning on the start page.** Nico asked for a "GPU
  selector"; a selector is **not buildable** — no web API enumerates or picks
  an adapter (WebGL's `powerPreference` is a hint, WebGPU refuses enumeration
  for fingerprinting reasons). What IS buildable and is worth more: read
  `WEBGL_debug_renderer_info`, NAME the adapter on the start page, and warn
  when it looks integrated/software, with the platform fix. Nico's call
  8 Sept 2026: *"let's drop 2 for now"*. Caveats when it is picked up:
  Firefox restricts the extension under `resistFingerprinting`, and it cannot
  detect the battery/P8 case at all (the adapter name is identical at 210 MHz
  and 3105 MHz) — only frame timing can.
- **A2–A6.** Built, measured, dropped from the mainline; they live on branch
  `v9.1`. The measurements are in docs/RESEARCH.md — **read that table before
  rebuilding any of them.** A4 −28% far edges for −6% throughput; A2+A3
  shore −71% / fireflies −83% for −2% (Nico: *"the beach fix was ok but had
  some other aliasing issues which made me prefer the older version"*); A5 a
  niche hover tool; A6 TAA measured **worse on both axes** (−31% detail,
  +30% temporal) and needs motion vectors to be viable.
- **`test_docs.js` CRLF fix is only on this branch.** If `v9.1` is ever
  checked out fresh its doc guard will go red for that reason alone.

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
