# Roadmap (drafted after the terrain/shimmer research session)

## ⚠ PARTLY UNBLOCKED — read this first (updated 9 Sept 2026)

**The barrel AC adapter is still dead. Nico is on USB-C PD.** The graphics
work is no longer fully blocked — the RTX does leave its idle P-state on
USB-C — but it is not running at full power either.

| power source | pstate | SM clock | draw |
|---|---|---|---|
| battery (8 Sept) | P8, 146/150 samples | 210 MHz | 5.5 W |
| **USB-C PD (now)** | P4–P5 | 855–1710 MHz | 13–20 W |
| 240 W barrel (spec) | P0 | up to 2040 MHz | up to 150 W |

**The finding that matters:** `power.default_limit` reads **80 W** against a
`power.max_limit` of **150 W**, and one sample caught the card at exactly
1455 MHz — the documented boost ceiling for a 4090 Laptop at 80 W TGP. So the
GPU is on the 80 W profile.

⚠️ **Not yet separated: is that cap the USB-C supply, or G-Helper?**
`performance_mode` is now 0 (Balanced); it was 2 (Silent, limits 80) during
the v9.2 hunt. **Try Turbo before concluding a new adapter is needed.** That
is the single cheapest experiment left and nobody has run it.

Nico's verdict 9 Sept 2026, after the adapter research: *"it looks like I need
a new adapter."* The failure pattern (dies, revives after being left unplugged,
dies again after a reboot) is a latched protection circuit, not a dead brick,
and is reported on other ROG units — full write-up and sources in
**docs/RESEARCH.md §4**, which also covers iGPU vs dGPU and the Chrome flag.

**Chrome on the dGPU** (needs its own `--user-data-dir`, or a running Chrome
swallows the flag):

```sh
chrome.exe --user-data-dir=%TEMP%f-rtx-profile --force-high-performance-gpu http://127.0.0.1:8734/index.html
```

**Still untested from v9.2:** the periodic hiccup. It appeared ONLY on the RTX
(never the iGPU), on both A1 and v9.1, and went away after a reboot —
consistent with a driver clock/power-state transition, not the game. Frame-time
sampling found zero spikes above 1.8x median, and the only teleport in world
state was jul's ring recycler (~4 km on a ~4 s cadence, `js/rings.js`,
untouched by any A-commit). Re-test on real AC.

---

## ▶ NEXT SESSION — START HERE (work queue, in order)

**Version is v9.3, and so is the branch.** `main` points at it again.

0. **Run the gates.** `node test/run_tests.js` should print "all suites
   passed" (**54 assertions, 9 files**; two skip without `npm install`).
   Then `python serve.py 8734`, press
   START, fly it once.
1. If you are changing anything in `test/`, also run **`node test/mutants.js`**
   (slow, opt-in, 23/23 caught as of v9.3). A green suite is not evidence:
   two assertions were found passing for the wrong reason on 9 Sept 2026.
   See the header of that file before trusting any test you did not break.

2. ▶ **Coverage still missing. THIS IS THE NEXT ITEM.** `terrain.js` got its
   test in v9.3 and the module graph now boots in jsdom, but these have no
   behavioural coverage at all: `flight.js`, `rings.js`, `weapons.js`,
   `spores.js`, `fx.js`, `math.js`.
   * **`rings.js` first.** jul's 4 s delayed recycler is the only thing in the
     world that teleports (a ring moves ~4 km on a ~4 s cadence) and it was a
     suspect during the v9.2 hiccup hunt that was never cleared. It is also
     jul's code, so a test there is the most useful thing to hand back in a
     volley.
   * `flight.js` next: the auto-level clamp (~49°), the SPACE free-flight
     path, and the camera terrain clamp all have documented bug history in
     docs/HISTORY.md and none of it is pinned.
   * Use `test/harness.js` (stub the imports) and run `node test/mutants.js`
     afterwards — a new assertion is not trusted until a mutant proves it red.

3. **B2 — TerraForge3D biome ports** (mesas + canyons first, MIT attribution
   for Jaysmito Mukherjee in the README), then **B1 — multifractal octaves**
   (Musgrave-style octave coupling + a slider; mirror it in `terrain.js` —
   and `test_terrain.js` will now hold you to that).

4. **Push the branch and update the PR to julaub.** `main` and `v9.3` are
   **18 commits ahead of `origin/main`** and nothing has been pushed since
   v8.0. `origin` is Nico's own fork (mtnico3000); PRs go to julaub. **Ask
   before pushing — it is a volley.** Still not done as of 10 Sept 2026,
   because it has never been asked for.

### ✅ Landed 10 Sept 2026

- **C2's two remaining ports.** Nico approved the dev dependencies (*"ok for
  npm for the remaining C2 ports"*). `npm install` brings
  `@shaderfrog/glsl-parser` and `jsdom`; both suites skip themselves with a
  note when `node_modules` is absent, so a fresh clone still runs the other
  seven. Suite is now **54 assertions across 9 files**, 26/26 mutants caught.
  Beyond ticking the box: the uniform budget stopped being a guess (**238**,
  not the "~260" carried in CLAUDE.md for months), and a misspelled shader
  function call is now a test failure instead of an 80 s driver compile error.
- **Branch renamed `v9.2` → `v9.3`**, and `main` fast-forwarded onto it — it
  had quietly fallen 3 commits behind while the ROADMAP still claimed "main
  points at it".
- **The hull-conforming bomb ring is confirmed good** by Nico, from a
  screenshot at 103 fps / 1036x905 on the dGPU. That closes the last open
  visual question from v9.3.

### Open questions for Nico

- Turbo vs a new adapter (see the top of this file) — one command decides it.
- **Does the shader still LINK on jul's phone?** 238 uniform slots is above
  the 224 that GLSL ES 3.0 guarantees. Desktop is fine and the count is now
  tested, but the mobile half needs a real device — nobody has tried.
- Push to origin / open the PR to julaub? 18 commits are waiting.

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
2. **Port the Node test harnesses (S/M)** — ✅ mostly done. `test/` runs with
   54 assertions across 9 files plus `check_module_refs.py`, and
   `test/mutants.js` verifies the tests themselves (26/26). The GLSL parse and
   jsdom smoke ports landed 10 Sept 2026 and are the only two needing
   `npm install`; they skip themselves without it. Flight modes and rings
   still have no coverage — see item 2 in the queue.
3. **Uniform budget check (S).** ✅ now MEASURED, not estimated: **238 vec4
   slots**, counted from the parsed GLSL by `test_glsl.js`, which fails above
   a 260 ceiling. The old "~260" was a guess. Still **above the 224 that GLSL
   ES 3.0 guarantees**, so the shader may fail to LINK on jul's phone while
   every desktop is fine — that half is untested and needs a real device.
   Biggest consumers: `uBlastCell[64]`=64, `uFxPos[48]`=48, `uRingMats[8]`=24,
   `uCloudPos[16]`=16. Pack those into a texture before trimming elsewhere.
4. **GitHub Pages deploy (S).** Playable URL for the ping-pong, no local
   server.

## D. Parking lot (discussed, not committed)

- Mandelbulb/Mandelbox flyable landmark variants (negative-scale organic
  family is the visual gold: boxScale ≈ −1.5…−2.8).
- Alien counterplay escalation (harvesters reacting to being bombed).
- Multiplayer-ish: pilot-name livery already persists; ghosts someday?
