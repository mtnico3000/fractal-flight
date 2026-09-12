# Fractal Alps — Mandelbrot Flight (CLAUDE.md)

WebGL2 raymarched flight game over a Mandelbrot-shaped island. No meshes, no
textures: every pixel sphere-traces a procedural world each frame. Two-player
"ping-pong" development between Nico (mtnico3000) and jul (julaub) — code
volleys via PRs on github.com/julaub/fractal-flight. Current version: v9.4.

## Builds — IMPORTANT

The modular repo is the SINGLE SOURCE OF TRUTH. Dual maintenance ended with
ROADMAP C1 on 6 Sept 2026.

- **Modular** (this repo): index.html + css/style.css + 18 js/ modules. ES
  modules → MUST be served over HTTP (`python serve.py 8734` — the bare
  `http.server` sends no cache header, so an edited module survives a refresh
  and looks like it changed nothing); file:// shows an explanatory watchdog
  message instead of loading.
- **Single-file** (`fractal-flight-v9_4.html`): a GENERATED ARTIFACT. **Never
  edit it.** It is the double-click build jul and everyone else actually
  plays, so it ships in the repo even though it is generated.

```sh
node build.js          # regenerate the artifact after ANY change to js/, css/ or index.html
node build.js --check   # is the committed artifact current?
```

`build.js` resolves the import graph from `js/main.js`, emits the modules in
the browser's own evaluation order (depth-first post-order — derived, never
hard-coded), strips imports/exports, inlines the CSS, flips the index.html
`__ffModular` watchdog flag and wraps everything in an IIFE with `'use
strict'` so the artifact keeps module semantics instead of publishing 200
globals. It refuses to build on a top-level name collision or an unimported
cross-module reference (it runs `check_module_refs.py` itself).
`test/test_build.js` fails if the committed artifact is not byte-identical to
what `build.js` produces — that is what makes "never edit it" enforceable.

## Architecture map (js/)

- `main.js` — boot (async shader compile w/ KHR_parallel_shader_compile,
  start page, pilot name/livery), the rAF loop, ALL uniform uploads, the
  probe readback, fx canvas draw calls.
- `shaders.js` — vsSrc/fsSrc template strings. **A backtick anywhere in
  here ends the JS template early** — `build.js` parses the bundle to catch
  it. Footprint-aware LOD (A1): `octW/noiseLOD/fbmLOD/fbmRLOD/ridgedLOD`
  fade an octave out as it crosses Nyquist for the pixel footprint, and
  `terrainShapeLOD(p, px)` is the ONE terrain body — see the collision note
  below. The fragment shader IS the game world: terrainShape (2× mandelDE + domain-warped ridged fbm + lakes),
  plantEval (tree-fern SDF, Julia-carved fronds), clouds, water, craft SDF,
  rings (mat 5), laser sheets + energy beams (both depth-tested against the
primary hit), alien fleet (mat 6: blue-toned box-cropped mandelbox ships;
  relay = power-8 mandelbulb), shadow pack, laser sheets, sky/fog/dusk.
- `flight.js` — 6DOF triad flight (Rodrigues rotations), arcade auto-level
  (SPACE = raw free flight), chase camera + mouse orbit + wheel zoom +
  cockpit + observation mode (O), camera terrain clamp, far-zoom loop
  stand-off, view-memory for Y/X toggles.
- `terrain.js` — CPU (fp64) mirror of terrainShape. MUST stay numerically in
  sync with the GLSL (ring/cloud/alien placement, camera clamp use it).
  Reads live TUNE values.
- `rings.js` — jul's ring course: land-seeking spawn, plane-crossing pass
  detection, 4s-delayed behind-recycling (loops must not recycle the course).
- `aliens.js` — invasion economy: mothership (10000 bomb hp) → harvesters
  (100 hp, laser-sheet tree sweeps via the blast queue) → energy shots →
  relay growth (6 hp) → blast → new harvester (cap 6). Fall + melt states.
- `weapons.js` — 8 tracer slots, 3 bombs, blast queue (GPU-verified tree
  kills). `activeBlast.harvest` marks alien sweeps (no player score).
- `spores.js` — tree harvesting score + 512² collected-cells texture (unit 1).
- `fx.js` — 2D overlay canvas: contrails, tracers, bomb blink, blast rings,
  pops. **The overlay has NO depth buffer** — anything that can pass behind
  terrain belongs in the shader instead. The alien energy beams were moved
  there on 9 Sept 2026 for exactly that reason. Occlusion via GPU probe queries (48 slots).
- `audio.js` — all synthesized (engine + LFO wobble, grind, wind, pops, guns,
  bombs, zap, relay blast, crash). M toggles mute.
- `tune.js` — TUNE (world panel) + TUNEA (green Aliens panel, bottom-right).
- `input.js`, `hud.js`, `renderer.js`, `state.js`, `clouds.js`, `math.js`,
  `config.js` — as named. state.js holds shared mutable objects (craft,
  camPos/viewPos, camMode, viewZoom, pilotAim, probe, flags) mutated in
  place, never reassigned.

## The GPU probe row (collision authority)

Bottom pixel row (y<1, x<133) encodes answers in the SAME fp32 math that
renders: px 0-1 craft ground/plant · 2-17 bullets · 18-81 blast cells ·
82-84 bomb grounds · 85-132 fx occlusion visibility. main.js reads it back
with ONE readPixels per frame. Collision agrees with pixels bit-for-bit.
The JS terrain mirror only bridges the first frame.

⚠️ **A1 split "the terrain" in two, and the split is load-bearing.**
`terrainShapeLOD(p, px)` is what the camera marches, with detail faded to the
pixel footprint; `terrainShape(p)` is `terrainShapeLOD(p, 0.0)` and is the
COLLISION AUTHORITY — the probe row and `terrain.js` both answer with it, and
it is bit-identical to pre-A1 (`mix(mean, n, 1.0)` returns `n` exactly, and
`smoothstep` below its low edge returns exactly 0). Point `terrainShape` at
the marching footprint and the world you hit stops being the world you see,
silently and only at distance. `test/test_shader.js` guards it.

## Shader material IDs

0 sky · 1 terrain · 2 water · 3 craft · 4 plant · 5 ring · 6 alien fleet
(mal.y: 0 mother, 1..6 harvesters, 7 relay bulb).

## Controls

A/D bank (clamped ~49°, auto-level on release) · W/S pitch (loops) · SPACE
hold = raw free flight (no auto-level; axis-stable barrel rolls) · Q/E lift ·
SHIFT boost · click fire / right-click bomb / right-drag sun · R full reset ·
M mute · Y mouse-cam+zoom toggle (remembers the view exactly, instant off) ·
X pilot view toggle (gaze aim = weapons) · O observation hover (arrows move,
W/S up/down, forces Y) · M-CLICK recenter view · WHEEL zoom (Y on).
Key chips in the HUD glow green when a toggle is active.

## Gotchas (hard-won)

- **e.code is physical-position**: on QWERTZ keyboards the Y keycap reports
  'KeyZ' — that is why camera-toggle binds BOTH KeyY and KeyZ. Never bind
  letters without checking layouts.
- **Version-comment drift**: whole-file version bumps (v9.0→v9.1) also
  rewrite version strings inside code comments, silently breaking exact-match
  patch anchors later. In Claude Code, use git diffs instead of string
  patching and this class of bug disappears.
- **Single vs modular naming — GONE as of C1.** The hand-built single file
  used `gpuGround/gpuPlantD` and `drawTrail(camB, now)` where the modules use
  `probe.ground/probe.plantD` and `drawTrail(..., bullets, bombs, impacts)`.
  The artifact is now generated FROM the modules, so there is exactly one set
  of names. Do not reintroduce a second vocabulary.
- **Vars used by the camera must not be declared inside the flight-physics
  branch** (observation mode skips it): rollFree, groundH, b are hoisted.
- **uniform budget: 242 vec4 slots — MEASURED, 12 Sept 2026**, by walking
  the parsed GLSL in `test/test_glsl.js`, which now fails the build above a
  260 ceiling. The long-standing "~260" in this file was an estimate and so
  was the "~267" that briefly replaced it; both were wrong. The concern is
  still real: GLSL ES 3.0 guarantees only **224**, so at 242 the shader may
  fail to LINK on the weakest target while every desktop is fine. The four
  biggest consumers are `uBlastCell[64]`=64, `uFxPos[48]`=48,
  `uRingMats[8]`=24 and `uCloudPos[16]`=16 — pack those into a texture before
  trimming anything else. This is also why the bomb-hit flare is ONE vec2 for
  the whole fleet rather than a per-hull array, and why the energy beams
  upload `(source, head, tail, fade)` instead of endpoints —
  `uShipPos`/`uRelay`/`uMotherPos` already hold the geometry.
- **fp32 terrain quantization**: don't move MB_CENTER/MB_SCALE without
  updating BOTH shader constants and terrain.js literals.
- **Trees**: plantEval must match its collision-probe usage (probes pass
  march-distance 0 = full size; rendering shrinks with distance ≥550m).
- The tune sliders ARE gameplay-affecting (terrain mirror reads them), so
  rings/aliens/camera adapt live.
- 🧊 **ONE exception freezes the game FOREVER, silently.** `frame()` in
  main.js reschedules itself on its LAST line (`if (running)
  requestAnimationFrame(frame)`) with no try/catch around the body. Any throw
  means no next frame: the world stops dead while the WebAudio thread plays
  on, so it presents as "frozen but I still hear the engine" and NOT as a
  crash overlay. The `#err` overlay is wired only to shader compile errors in
  renderer.js, so a runtime throw shows nothing at all. **When a freeze is
  reported, the browser console is the first thing to read** — it names the
  file and line for free. Found 6 Sept 2026 (see docs/HISTORY.md).
- ⚠️ **A name another module exports can be used with NO import and still
  work in the single-file build** — it is one global scope there — while
  throwing ReferenceError in the modular one. `js/fx.js` referenced `camPos`
  (never imported) inside the `kind === 3` bomb-ring branch; the single file
  was fine, the modular build froze on the first bomb that reached the
  ground, and it survived from at least v8.0 because the single file is the
  one people actually play. `python test/check_module_refs.py` now guards the
  whole class — run it after ANY cross-module edit.
- **The fx 2D overlay must project from `viewPos`, never `camPos`** — the
  v7.1 invariant is that the GPU and the overlay consume the SAME rotated
  view, or they drift apart the moment the mouse orbit is used.
- 🎚️ **A range input inside a flex row will not shrink.** Flex items default
  to `min-width:auto`, which for a range control resolves to its intrinsic
  ~129px, so `flex:1` cannot shrink it: the tuning rows measured 273px inside
  a 244px panel and pushed the value readout out of the panel. Invisible on
  the left-anchored TUNING panel (overflow spills into the screen), fatal on
  the right-anchored ALIENS one (spills off-screen). `min-width: 0` on the
  input is the fix.
- **A downed hull is inert**, via `hullAlive()` in aliens.js — no bomb hits
  and no ALIEN HULL crash while falling, melting or gone. Without it the ship
  you just bombed kills you on its way down (you are by definition beside it)
  and its melting wreck is an invisible killbox at ground level for 8 s.
- 🏷️ **`css/style.css` began with a literal `<style>` line** — a leftover
  from when the CSS was lifted out of the single file. CSS is not HTML: the
  parser reads `<style> * { … }` as ONE invalid qualified rule and discards
  the prelude AND the block, so **the universal reset was silently dead in
  the modular build** for its whole life — `box-sizing: content-box`, default
  `h1`/`h2` margins, panels overflowing their own width. It only surfaced
  when C1 inlined the file and produced a nested `<style>`. Removed 6 Sept
  2026; the modular HUD layout visibly changed for the better. Lesson: an
  invalid rule at the top of a stylesheet eats the rule after it.
- 🔁 **`core.autocrlf` is true on Windows, so a fresh clone is all CRLF.**
  `build.js` normalizes every source it reads to LF (`read()`), or the
  artifact would come out CRLF-flavoured on one machine and LF on another and
  `--check` would call it stale forever. Found the hard way: a single
  `git checkout js/config.js` re-materialized ONE 29-line file as CRLF and
  put 28 stray `
` into an otherwise byte-stable artifact.
- 🖥️ **ASK WHAT RESOLUTION AND WHICH GPU BEFORE DEBUGGING ANY GRAPHICS
  COMPLAINT.** The whole of ROADMAP section A was built to fix a "shimmer"
  that was really 683x359 on an Intel iGPU while an RTX 4090 sat idle in the
  same laptop. Three compounding causes, all outside the code: the browser
  defaults to the integrated GPU (no per-app preference; `powerPreference:
  'high-performance'` is only a HINT and was not enough), the fps counter
  could not report below 20 so the auto-scaler pinned resolution at its 0.4
  floor, and on battery the dGPU sits at P8 / 210 MHz / 5.5 W against a
  3105 MHz maximum. Fixed, the same code runs 1706x1495 at 37-45 fps with no
  visible shimmer. One-off dGPU test:
  `chrome.exe --user-data-dir=<temp> --force-high-performance-gpu <url>`,
  confirmed with `nvidia-smi`. Full write-up in docs/RESEARCH.md §3.
- ⏱️ **The fps counter is not an instrument, and it steers the auto-scaler.**
  `frame()` clamps `dt` to 0.05 s so a stall cannot integrate one huge physics
  step. The fps STAT must use the unclamped `rawDt` — accumulating the clamped
  value pinned the readout at exactly 1/0.05 = 20 however bad things got,
  which blinded `adjustQuality()` and produced a published cost figure that
  was wrong. For real numbers use median `requestAnimationFrame` deltas.
  `test/test_render.js` guards it.
- 📈 **The `resolution` knob is the strongest antialiasing lever in the
  game**, and the only one with no downside: 0 = auto (the adaptive scaler),
  above 1 supersamples (the browser downsamples the oversized buffer on
  composite). Measured −52% visible shimmer at 2x for 3.7x the frame time;
  cost is linear in pixel count, ~1.9x per doubling. The HUD `RES` readout
  exists because a resolution slider whose result you cannot see is unusable.
- 🏎️ **`DPR` is capped at 1.0** (renderer.js), so the drawing buffer is
  `clientWidth * renderScale`, NOT `clientWidth * devicePixelRatio`. Any
  before/after measurement must peg the adaptive scaler first — it resizes the
  buffer, which changes `uPixScale`, which changes the LOD being measured.
- 🔁 **`core.autocrlf` is true, so even `git checkout -b` hands files back as
  CRLF.** `build.js` normalizes with `read()`, and `test_docs.js` had to do
  the same after every regex anchored on a newline silently stopped matching
  on a fresh branch. Any new file-reading check needs the same treatment.
- ✂️ **A2–A6 were built, measured and deliberately dropped** — they live on
  branch `v9.1`, with numbers in docs/RESEARCH.md. Do not rebuild them
  without reading that table first. A1 is kept because it is a net speedup
  (+3%) as well as a quality gain.
- 📏 Measured 6 Sept 2026: at the current fleet tuning a **harvester never
  visibly falls**. It hovers 45..60 m up while `shHei/2` is 60 m, so
  `fallAndMelt` lands it in the very frame it dies and it melts in place. The
  mothership (2200 m) and relay do fall. Cost a red test before it was
  understood.
- 📐 **A hit tolerance measured ALONG the ray is an error budget divided by
  the incidence angle.** `tolRay = 0.01 + 0.0015 * t` permitted a *vertical*
  error of `tolRay / sin(incidence)` — a 38x amplification for a ray grazing
  the ground at 1.5 degrees — and because `t` advances in steps that error
  quantised into shells. That is what the concentric viewer-centred rings
  were, for the whole life of the project: iso-contours of the tolerance, not
  aliasing (they survived 2x supersampling). Fixed with one `max`:
  `tolRay * max(abs(rd.y), 0.06)`, which cut mean hit error 10.5x and p99 16x
  for +4.6% iterations. The `0.06` floor stops a near-horizontal ray from
  demanding unbounded precision. `uRayTol` keeps it A/B-able from the Debug
  panel. Numbers in docs/RESEARCH.md §5.1.
- 🐴 **A ray nearly tangent to a big flat face needs a big iteration budget,
  and running out looks like a SPIKE, not like a miss.** Both box marches had
  48 iterations; 18.8% of rays that genuinely hit the mothership were hitting
  the cap and drawing horns on the rounded corners. 384 takes it to 1.3%, and
  average iterations move only 14.1 → 42.2 because the cost is paid by the few
  grazing rays — the cap is a ceiling, not a workload. ⚠️ **Step relaxation
  makes this WORSE** (390 misses vs 365 at the same cap): a relaxed step covers
  less ground per iteration, so a budget-bound march gets less far. This does
  NOT apply to the terrain march, which caps out on 0 of 1784 rays — `T_MAX`
  bounds how grazing a terrain ray can be and still hit. docs/RESEARCH.md §5.2–5.3.
- 🌊 **The wiggly coastline and the flickering waterline are not bugs.** The
  shoreline deviates from its own smoothed shape by 8.4 m RMS over 20 m and
  107 m over 1 km — self-similar, i.e. real fractal geometry — because the
  beach grade is 2.35%, so every metre of terrain noise moves the waterline
  43 m sideways. And the boundary is not misplaced: **0 of 72 600 pixel rays**
  classify land vs water differently from a 4000-iteration reference. One ray
  per pixel means a boundary flips sub-pixel; the only cures are more samples
  (the `resolution` knob) or exact geometry (v10). Do not re-open this as a
  marcher bug. docs/RESEARCH.md §5.4–5.5.
- 🚧 **The tree being served is the tree being tested.** A temporary revert
  plus `node build.js`, taken to get an A/B reading while Nico was flying,
  reached him on his next reload and put the bug he had just confirmed fixed
  back on his screen — *"Did you do a temp change for a test, and then
  reverted?"* Nothing in the code can guard this. **Say so before touching a
  served tree, or take the reading in a `git worktree` on its own port.**
- 🔬 **A null result from an unrepresentative sample is not a null result.**
  `terrainNormal`'s epsilon was cleared by measuring the shading swing at a
  *flat beach* point, where it is 0.0%. On a ridge it is 19.7%. Pick the sample
  where the effect would be strongest, or the measurement proves nothing.
- 🕐 **One reading is not a measurement, and shader compiles are the worst
  case.** A 212 s compile was reported as a regression from the raised
  iteration caps; a controlled A/B put the *original* caps at 243 s. Driver
  compiles on this project run 200–240 s and vary by more than most effects
  being measured, so always take both sides in one sitting.
- 🌐 **`serve.py` bound IPv6-ONLY and refused `127.0.0.1`** (found
  12 Sept 2026, when Chrome said "site can't be reached" against a server that
  was printing a perfectly healthy banner). With no bind argument the stdlib
  picks the IPv6 wildcard — hence `Serving HTTP on :: port 8734` — and on
  **Windows `IPV6_V6ONLY` defaults to 1**, so `[::1]` and `localhost` work
  while `127.0.0.1` is refused. `python -m http.server` does not have this
  problem because it clears that option in a `DualStackServerMixin` which the
  stdlib defines INSIDE its own `__main__` block, so `serve.py`'s
  `http.server.test()` call never inherited it — despite serve.py's docstring
  claiming to be exactly that "plus one header". On Linux the default is
  already 0, which is why it stayed hidden for the life of the project. Fixed
  with a `DualStackServer` ServerClass; `test/test_serve.js` opens a real
  socket over IPv4 and fails if it regresses. **Lesson: "the server is
  running" and "the server is reachable at the address in the docs" are two
  different claims, and only one of them was ever checked.**

- 🖼️ **The fx overlay has NO depth buffer, so anything that can pass behind
  terrain does not belong on it.** The alien energy beams were 2D lines on the
  overlay and were painted straight over the mountains they crossed. Moved
  into the fragment shader on 9 Sept 2026, where comparing the ray's closest
  approach against the primary hit distance occludes them against terrain,
  hulls and trees at once. The harvest laser SHEET had been doing this
  correctly since v9.0 (`tp > t`) — the precedent was already in the file.
- 🧹 **When a draw call moves, check what else it was doing.** `fx.js`
  `drawBolts()` was the only thing splicing spent bolts out of `alien.bolts`.
  Moving the beams into the shader deleted it, and nothing else pruned the
  array — it would have grown for the entire session, taking the arrival loop
  with it. Rendering code that also owns lifetime is a trap; the pruning now
  lives in `updateAliens` with a test.
- 🎛️ **A size knob that also sets a rate must derive the rate.** The relay
  grew `baseR * 0.02` per energy arrival and blasted at `2 × baseR` — exactly
  50 arrivals. Making the relay 5× bigger without touching that would have
  needed 300 arrivals and the blast would effectively never come. It is now
  `(RELAY_GROW - 1) / RELAY_STEPS` with `RELAY_STEPS` pinned at 50, so
  resizing the bulb cannot silently re-pace the invasion economy.

## Tests — `node test/run_tests.js`

**ROADMAP C2 has started.** `test/` exists and runs with no npm, no framework
and no browser — same no-bundler reasoning as the game itself:

```sh
node test/run_tests.js        # everything
```

- `test/harness.js` — loads a REAL `js/` module with stubbed imports (strip
  `^import` lines, strip `export `, `new Function(...stubNames, src +
  'return {...}')`), plus an `extra` list so private names (`HP_MOTHER`,
  `hullAlive`) can be asserted. Tests the shipped source, not a copy.
- `test/test_aliens.js` — bomb counts per hull, and the matrix proving a
  live hull is lethal while a falling/melting one is inert.
- `test/test_tune.js` — every knob ships with `v === d` (they are hand-edited
  in pairs across 46 knobs (20 world + 15 aliens + 11 debug), and a missed `d` only shows when someone presses
  RESET), defaults inside their own range, knob shape, and an informational
  list of defaults pinned at a slider end.
- `test/test_build.js` — the single file must be byte-identical to what
  `build.js` generates from the current modules, every module must reach the
  bundle, no `import`/`export` may survive the strip, and the artifact must
  reference nothing external (it has to run from a double-clicked `file://`
  page, where every fetch fails silently). Verified to go red both ways —
  editing a module without rebuilding, and hand-editing the artifact.
- `test/test_shader.js` — shader-source invariants Node cannot get any other
  way until the GLSL parser lands: `terrainShape` is still the px=0 wrapper,
  the probe row never calls the LOD variant, faded octaves decay toward the
  measured octave MEAN (toward zero and distant ground sinks as you fly at
  it), and no stray backtick closes the GLSL template. All three mutations
  verified red.
- `test/test_render.js` — the two render-path invariants that fail SILENTLY:
  the fps stat uses the unclamped `rawDt` (it floored at 20 and blinded the
  auto-scaler), and a manually pinned `resolution` makes `adjustQuality()`
  stand down (otherwise the slider appears to do nothing). Plus the
  MAX_TEXTURE_SIZE clamp that keeps a 2x supersample from failing in
  resize(). All three mutations verified red.
- `test/test_terrain.js` — the CPU mirror vs the GLSL it mirrors, the last
  module in the collision path with no coverage. Golden heights under a
  PINNED TUNE stub (so retuning the world cannot false-red it), the
  Mandelbrot constants compared numerically against the shader (`1.0e-4` in
  GLSL vs `1e-4` in JS), and the DERIVED ones reconstructed: the shader's
  `smoothstep(0.58, 0.72, v)` is `(v - 0.58) / 0.14` in the mirror, so the
  high edge survives only as a span and is checked as `0.58 + 0.14 === 0.72`.
  Also guards `terrainCheapH()`, the THIRD copy of the shaping maths (shadow
  rays) — deliberately coarser, but it has to share the constants or shadows
  are cast by a different mountain than the one drawn. 12 mutants verified red.
- `test/test_docs.js` — README and CLAUDE.md must list every js/ module and
  no ghost, the module count must be right, and the Running command block
  must invoke serve.py. The README listed the v5 module set until 6 Sept
  2026 (aliens.js and tune.js absent) — nobody notices a file that is not
  there, so it is checked rather than remembered.
- `test/check_module_refs.py` — the modular/single-file divergence guard
  above. Verified to go RED on the real `camPos` bug before being called
  green. It earned its keep again on 9 Sept 2026, rejecting a local named
  `U` in fx.js that collides with renderer.js's exported uniform table.
- `test/test_glsl.js` — the shader as CODE (needs `npm install`). Parses both
  templates with `@shaderfrog/glsl-parser`, so a syntax error fails in
  milliseconds instead of costing an 80 s driver compile; asserts that the
  only unresolved names are the two function-like `#define` macros (`BDE`,
  `SDE`) and `gl_FragCoord`, which makes a **misspelled function call** a test
  failure rather than a browser surprise; and measures the uniform budget
  above. Every other shader check in the repo is a regex over source text, and
  regexes have been fooled here twice.
- `test/test_smoke.js` — boots the WHOLE module graph in jsdom (needs
  `npm install`). Every other suite loads one module with its imports stubbed,
  so nothing had ever executed the modules together against a DOM — which is
  the exact shape of the two worst bugs this project has had (`camPos`, and
  the dead CSS reset). Stops at module evaluation: jsdom has no WebGL2, so
  nothing past START is reachable. It reuses `build.js`'s own `RE_IMPORT`
  rather than copying it — a naive `/^import/` mangles main.js's multi-line
  imports — and also checks every `getElementById` in `js/` resolves against
  index.html.
- `test/test_panels.js` — the tuning panels as a real DOM (needs
  `npm install`). The Debug master is the one control that WRITES to every
  other knob, and its failure mode is silent data loss — dial a setup in,
  press DEBUG, setup gone. `test_tune.js` reads the knob objects and never
  builds a panel, so nothing could see it. Also covers the debug bitmask the
  shader reads, that all three panels live inside `#panels` (a panel outside
  the stacking column draws over its neighbour), and that INVADERS DEFEATED
  only replaces the counter when harvesters AND relays AND motherships are
  all gone. It inlines `css/style.css` into the jsdom document, because a
  visibility question asked without the stylesheet answers 'visible' always.
- `test/test_serve.js` — `serve.py` over a REAL socket. The only suite that
  opens one, because the only bug it can catch needs one: the dev server bound
  IPv6-only and refused `127.0.0.1` while looking healthy (see the gotcha
  above). Asserts IPv4 AND IPv6 both answer 200, and that the two reasons
  serve.py exists at all survive — `no-store` on modules, and
  `text/javascript` rather than the registry's `text/plain`. Both of those
  fail silently in a browser. Uses a random high port so a dev server already
  running on 8734 cannot make it pass or fail for the wrong reason.
- `test/mutants.js` — **tests for the tests.** Not run by `run_tests.js`
  (slow, and it writes to `js/` as it works; it refuses to start if those
  files are dirty). It breaks the source one bug at a time and requires every
  test to go red. **A green suite is not evidence until this passes**: on
  9 Sept 2026 two assertions were passing for the wrong reason — one read
  past the end of the function it was checking and was answered by its
  neighbour, the other was satisfied by a melting hull sinking rather than by
  the predicate it named. **37/37 mutants caught as of v9.4.** It earned its
  keep again immediately: `test_panels.js` was written, passed all six of
  its assertions on the first run, and the battery showed its HEADLINE
  mutant ESCAPING — the UI round-trip it drove could not reach the branch
  that had actually broken, because `armMaster()` stops that state from
  arising at all. The assertion was rewritten to test the guard as the
  second line of defence it is. Write the test, then break the thing it
  names — a suite that has never been mutated has not been checked.

**ROADMAP C2 is complete.** The three npm-dependent suites
(`test_glsl.js`, `test_smoke.js`, `test_panels.js`) SKIP with an
explanatory line when `node_modules` is absent, so
`node test/run_tests.js` still works on a bare clone: the GAME keeps its
no-dependency promise and only the dev tooling asks for `npm install`
(@shaderfrog/glsl-parser, jsdom). Traps met on the way: function-like
`#define` macros produce ignorable parser warnings; jsdom needs a
`matchMedia` stub and must NOT have Node's `performance` overridden; and
a jsdom test that asks whether something is VISIBLE has to inline
`css/style.css` itself.

## History & roadmap

Full version-by-version chronicle with the WHY behind every design decision
and every bug post-mortem: **docs/HISTORY.md** (read it before touching
flight/camera/rings/aliens — most "weird" code guards a documented bug).
Research notes (shimmer diagnosis + fix rationale, terrain-variation
papers, TerraForge3D findings, Mandelbox parameter guide):
**docs/RESEARCH.md** — required reading for ROADMAP sections A and B.
Source papers: **docs/papers/**.
Next steps: **docs/ROADMAP.md — the "NEXT SESSION — START HERE" queue at
the top is the active work list; pick up at the first unchecked item.**
One-line summary:
v2→v4.6 built the world/weapons/probe; v5 merged jul's rings + went
modular; v5-v6 restored arcade feel + start page; v7 camera suite +
shadows + fx occlusion; v8 view toggles with exact memory; v9 alien
invasion + observation mode; C1 ended the dual-maintenance (`build.js`).
Current: v9.4.
