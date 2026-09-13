# Development history — Fractal Alps / Mandelbrot Flight

Full chronicle of the Nico↔jul ping-pong and the Cowork (Claude) sessions.
Written for future contributors (human or Claude) who need the WHY behind
the code. Companion to CLAUDE.md (architecture) and ROADMAP.md (next steps).

## Origins (pre-merge)

- `remixed-32757f73.html` — the original volley jul sent: single-file WebGL2
  raymarcher, Mandelbrot-mass terrain, basic yaw/pitch flight.
- `fractal-flight-v2.html` — Nico's return volley (same line).
- jul forked the line into github.com/julaub/fractal-flight: modular split
  (12 files), added the RING COURSE (land-seeking spawn fan, chained course,
  pass-through scoring) and mobile input (virtual joystick, hold buttons,
  gyro tilt with iOS permission flow and screen-rotation remap), adaptive
  render scale, README. Two commits; second fixed ring spawning to stay
  over land.
- Meanwhile the Nico line advanced v2 → v4.6 in Claude sessions:
  - v4.0 free flight: orientation as an orthonormal triad (right/up/fwd)
    rotated incrementally via Rodrigues — no Euler, no gimbal lock; loops,
    rolls, inverted flight. v4.1 coordinated bank-to-turn gated by u.y.
  - Spore trees (v1.6-1.7 line): per-26m-cell tree-fern SDFs folded into the
    terrain march; trees are collectibles (fly through → pop, +1 spore);
    removal via a 512×512 R8 texture consulted by plantEval so renderer,
    collision and score agree; world wraps ~13.3 km.
  - GPU collision probe (v1.5→v3.3): bottom pixel row encodes terrain
    height / plant distance at craft + bullets + blast cells + bombs in the
    SAME fp32 math that renders; one readPixels per frame; JS fp64 mirror
    only bridges frame one. 24-bit fixed-point height encode over [−80,560].
  - Weapons: 8 fixed tracer slots (probe-pixel pairs), hold-to-burst;
    bombs (3 slots) with tunable launch angle, GPU-authoritative detonation
    querying up to 64 cells; ground-conforming blast ring drawn in 2D.
  - Clouds v4.3-4.4: cluster = slab + 4 cauliflower lobes in one bounding
    sphere; placement seeks terrain class; drift with one global wind;
    in-cloud wind audio via immersion metric.
  - Audio: synthesized engine (two detuned saws + filtered noise, banking
    LFO wobble), grind rumble, pops, gun/bomb/explosion, 8-bit crash.
  - v3.1 two-stage ground contact: grind band (rumble + camera shake +
    speed bleed) above the fatal crash level; splashdown separate.
  - v4.5 hash swap to Hoskins hash12 (old hash had axis-correlated grid
    artifacts). v4.6 exaggerated tree perspective: actual SDF size shrinks
    beyond 550 m (to 35% at 4 km); probes pass distance 0 so collision
    stays full-size.
  - Tune panel (15 sliders) driving shader uniforms; terrain mirror reads
    live values so gameplay follows the sliders.

## The merge (Cowork session 1) — v5.0

Analysis: jul's rings + mobile vs v4.6's everything; shaders had diverged
(material IDs clashed: his ring mat 4 = our plants). Decision: port rings
INTO v4.6 (rings became mat 5), then split the result into jul's modular
layout (17 modules) so the ping-pong could continue on GitHub. Ring spawner
rewired from his terrain mirror to our TUNE-aware terrainShapeJ. Touch/gyro
ported onto the 6DOF model with new FIRE/BOMB buttons. Verified with Node
harnesses (rings spawn 8/8 over land, ≥100 m clearance).

## Flight feel restoration — v5.1 → v5.4

- v5.1: wings-leveler on release (bank springs to 0 from any attitude).
- v5.2: THE reconciliation. jul's model treats roll/pitch as sprung ANGLES
  (roll → −steer·0.85 at 4.0/s; released pitch decays 0.5^(0.7·dt)); ours
  are free RATES. Solution: free rates while keys held, jul's exact spring
  curves on release. Gates keep aerobatics pure: W/S held = no roll
  leveling — this fixed the "barrel roll at the top of a loop" bug (the
  leveler fired at the apex where steer=0 and the craft is inverted).
- v5.3: arcade bank clamp at jul's 0.85 rad (~49°) with Y as "barrel roll
  allow"; bombs default 1°; SPORES moved next to RINGS top-center; bombs
  drawn 2× with faster blink.
- v5.4: Y didn't work on Nico's keyboard — e.code is PHYSICAL position, and
  QWERTZ reports the Y keycap as 'KeyZ'. Modifier moved to SPACE (layout-
  independent), which stopped firing (click-only). Camera roll-follow: jul's
  cam rolls only 30% with the plane, which is what makes bank READ on
  screen; ours now follows ~35% in cruise ramping to 100% for aerobatics.
  Bombs launch along the flight path + tune angle (dive throws steeper,
  climb lobs).

## Start page & packaging — v5.5 → v6.3

- v5.5: start overlay (the 15-20 s load is the DRIVER compiling the ~800-
  line shader — GLSL→HLSL→D3D on Windows; not "building the world").
  Async compile via KHR_parallel_shader_compile with status phases; CSS
  spinner survives sync-compile freezes (compositor thread). Pilot name +
  wing color (uLivery; hex→linear gamma 2.2; default #e05a51 reproduces the
  old red exactly), persisted in localStorage; inputs bind only at START so
  typing a name can't steer; START gesture enables audio immediately.
- v5.6: fields grey out during blocking compiles (no ext → Firefox freeze).
- v5.7: ready state drops the spinner, "Ready for flight" headline; 8 preset
  wing swatches (all offline — the color input was always native HTML5).
- v5.8: SPACE = FULL free-flight mode (all stabilizers off — sustained
  inverted flight, parked climbs), not just free roll.
- v5.9: barrel-roll axis wobble fixed — the coordinated-turn yaw term
  precessed the roll axis; it now fades with roll rate (0.00° drift over a
  6 s roll).
- v6.0: ring fixes. (1) Loops made rings VANISH: "flown past" recycling
  compared against the forward vector, which reverses at the apex, so the
  whole course respawned far away; now a ring must stay behind 4 continuous
  seconds. (2) Rim passes missed: scoring was a 0.8·radius sphere around the
  CENTER + approach-angle gate; replaced with segment/ring-plane crossing —
  anywhere in the full opening counts at any speed/angle (with a teleport
  guard for R-resets).
- v6.1/6.2: modular build "never finishes loading" = ES modules refused on
  file:// (CORS); added an inline watchdog that explains and suggests
  `python3 -m http.server 8734` (plus __ffBooted flag). v6.2b = correct
  single-file label (packaging mishaps produced dud files — see Lessons).
- v6.3: clean python3-only packaging (a PowerShell server experiment was
  rolled back — Windows blocked executing it from the app's sandboxed
  folder anyway).
- v7.0: Nico's world defaults baked into TUNE (18 knobs verified to render
  exactly as his screenshot); pushed to the fork; PR opened to julaub with
  fork+branch flow (credential manager + line-endings guidance).

## Camera suite — v7.1 → v7.9

- v7.1: mouse-orbit view. Screen maps to orbit: full width = 360° yaw
  (mouse right = see the plane's LEFT side), height = ±90° pitch, dead
  circle ≈ plane footprint + 20 px, eased. CRITICAL invariant: the orbit
  rotates the RENDER view only (viewPos), and BOTH pipelines (GPU uniforms
  and 2D fx projection) consume the same rotated view — this followed an
  alignment investigation (plane vs contrails offset) that concluded the
  pipelines are mathematically identical; a debug build with overlay
  crosshairs proved alignment on-machine (the perceived offset was trail
  curvature history).
- v7.2: wheel zoom (exponential, 0.07..400) down into COCKPIT view
  (uCockpit hides the craft; probe still uses the true position); pilot
  head = eased mouse angles; banking rolls the horizon.
- v7.3: far-zoom fixes. (1) The camera-pitch equilibrium needs
  30·(f·camU) ≈ 5.5·zoom — impossible past zoom ≈ 5.5 with a fixed 30 m
  look-ahead, so the view tumbled top→front→bottom forever; scaling the
  anchor with zoom preserves the equilibrium at every distance. (2) Chase
  spring lag (~27 m at cruise) floored the close-zoom distance; springs
  stiffen as zoom shrinks so the plane fills the screen pre-cockpit.
  (3) Cockpit gaze aims guns AND bombs (pilotAim).
- v7.4: contrails 2× + 4.5 s life (700-dot buffer); middle-click rebases
  the orbit center on the cursor (browsers cannot move the OS cursor).
- v7.5: middle-click also resets zoom, but only from beyond default.
- v7.6: SHADOWS PACK (tune toggle). Craft: real bounding-sphere + short SDF
  march with distance penumbra AND an altitude fade (solid <60 m, gone by
  160 m — first attempt shipped a dark blob visible from cruise height;
  caught numerically). Clouds: analytic chord attenuation through cluster
  spheres (dense core ~30% light, wispy rim, 0.18 skylight floor, drifts
  with wind for free). Trees: smart-fake blobs from the same placement
  hashes + harvest texture (pop a tree, its shadow dies same frame), sun-
  offset by crown height, ferns skipped, greenbelt-gated, 3×3 cell search.
- v7.7: R resets the view; far-zoom framing at 1/3 from bottom — learned
  that the rig rotates RIGIDLY around its equilibrium so aiming tricks
  cannot move the plane on screen (a K-sweep proved 0 effect); the actual
  knob is the arm's height/distance ratio, blended 5.5/17 → 4.0/17 with
  zoom (measured 0.334). Camera terrain collision: clamp to ground/water
  +3 m and re-aim at the craft while clamped.
- v7.8: far-zoom loop exception — when arm > altitude, following the nose
  through a loop would drag the camera into terrain; the camera keeps a
  LEVEL-FLIGHT HEADING MEMORY (updated only level+upright) and stands off
  level watching. First version re-engaged mid-loop because the craft
  CLIMBS through a loop (altitude ratio flipped back) — the state is now
  LATCHED: stand-off engages anytime, re-engage only in level flight.
- v7.9: fx occlusion — probe row extended 85→133 px with 48 visibility
  queries (16 trail polyline samples, 8 tracers, 3 bombs, 21 pops/impacts)
  marched against the SAME terrainShape the pixels render; soft answers
  fade grazing dots. Contrails/tracers/bombs/rings now hide behind
  mountains like the plane does.

## View toggles & polish — v8.0 → v8.5

- v8.0: cursor-visibility slider (native cursor at 100, custom canvas-drawn
  crosshair at chosen alpha between, hidden at 0; default later 0).
- v8.1: friend-friendly camera. camMode {free, pilot}: Y toggles mouse-cam +
  wheel (default OFF — mouse dead in plain flight), X toggles pilot view
  with gaze reset on every entry; Y binds KeyY AND KeyZ (QWERTZ); key-repeat
  filtered; transitions live in flight.js (input only flips flags).
- v8.2: Y-off snapshots the ENTIRE view (zoom, orbit origin/angles, chase
  camPos craft-relative + basis) and Y-on restores instantly (0.00 m
  deviation on a 723 m arm) — restoring zoom alone left the camera to
  spring 640 m. Green status chips on Y/X/M keycaps in the help panel.
- v8.3: angle restore made cursor-independent — originForAngles() inverts
  the orbit mapping by bisection through the deadzone ramp (R·ramp(R) is
  monotonic) so the current mouse reproduces the saved angles exactly.
- v8.4: X symmetric — pilot entry snapshots the outside angles, exit
  restores via the same inverse; Y-off during pilot stores the OUTSIDE
  view, not the gaze. (v8_4 files were duds from an anchor broken by
  version-comment drift; v8_4b is the good pair.)
- v8.5: Y-off is a hard CUT — the chase camera snaps to its analytic steady
  pose including spring lag (fixed-point iteration with look-ahead
  30 + speed/3.5), 1.58 m from ideal one frame after, no settle glide.

## Alien invasion — v9.0 → v9.1b

- v9.0: the fleet. Ships are BOX-CROPPED rectangular mandelboxes — fractal
  evaluated in a unit-cube domain (mandelboxDE: box fold ±uBoxParam.z,
  sphere fold minR²=uBoxParam.y, scale uBoxParam.x, 8 iters) intersected
  with the exact ship box via sdBox, conservative min-half-extent scaling;
  any aspect ratio, silhouette guaranteed, trig-free. Relay = power-8
  mandelbulb (7 iters, uBoxParam.w). Mothership 1×2 km ×100 m at 10 km
  (axis-aligned, 10000 bomb hp); 2 harvesters (200×60×20 m, 100 hp) drift
  BROADSIDE (long axis ⊥ heading, combine-harvester style) over plains
  seeking terrain 8..60 m; translucent fluo-green laser SHEET spans the
  full length down to terrain (analytic plane intersection, ground-contact
  glow, pulse); swept tree cells enqueue through the existing blast queue
  tagged harvest (pop + sound, NO player score, credits ship.absorbed);
  every 3 trees & ≥1.5 s a green bolt flies to the relay (+2% size); at 2×
  size a blue-white blast goes up and the mothership builds one more
  harvester (cap 6, deploys visibly). Relay sits 30 m over the highest peak
  found by 500-sample search. Bombs: JS oriented-box hull tests; hp 0 →
  fall (g≈20) → melt into terrain over 8 s (molten-orange emissive) →
  gone/removed. Flying into any hull = 'ALIEN HULL' crash. Green Aliens
  tune panel (TUNEA, 12 sliders, shared builder buildPanel()). Energy bolts
  on the fx canvas; zap + relay-blast synth sounds. Economy verified end-
  to-end in a Node harness.
- v9.1: harvester W/L/H sliders (up to 1200/800/300 m) plumbed through
  rendering + laser + hit-boxes; BIO-ORGANIC hull skin — the straight
  "energy seam" sine stripes (moiré source) replaced with alienFlora
  dendritic Julia veins + fbm mottling in the ship's LOCAL frame, fading
  to plain glow beyond ~1.2 km (no aliasing); OBSERVATION mode (O): speed
  →0, self-levels, arrow-key saucer translation + W/S vertical, terrain-
  clamped, no crash, forces the free camera and restores the previous Y
  state on exit; green O chip. Two real crashes caught by tests before
  ship: rollFree and groundH were declared inside the (now skipped) flight-
  physics branch but read by the camera — hoisted, plus an automated
  leak audit of the branch. v9_1b is the good pair (v9_1 shipped
  pre-fix — delete).

## First Claude Code session — 6 September 2026

The move off Cowork. The repo was opened in Claude Code with the v9.1b modular
files pasted in, and the first act was archaeology: everything after the v8.0
commit — the whole v8.1-v8.5 camera line AND the entire v9 alien invasion —
had never been committed anywhere. It existed as loose files with the zip as
its only backup. That is now `d3b1556`, landed as the zip arrived and verified
byte-identical file by file before committing, on a new branch `v9.1`.
`v7.0` was left pointing exactly at `origin/v7.0` so nothing jul has seen moved.

- **Tuning panels.** The ALIENS panel's numbers were off-screen, so a tuned
  world could not be read off to hand over. Cause, measured not guessed: a
  range input is a flex item with the default `min-width:auto`, which resolves
  to the control's intrinsic ~129px and refuses to shrink, so each row measured
  273px inside a 244px panel. The left-anchored TUNING panel had the same
  overflow all along — it just spilled into the screen instead of off it.
  `min-width: 0` fixed both. Added **COPY JSON** beside RESET on both panels
  (clipboard with an execCommand fallback, since `navigator.clipboard` needs a
  secure context and `http://<lan-ip>` and `file://` are not), so tuning is now
  exchanged verbatim instead of read off sliders by eye. Both buttons `blur()`
  after the click or the button keeps focus and SPACE — free flight — re-clicks
  it.
- **Nico's world and fleet baked in** as both `v` and `d`: 107 m ocean, 460 m
  peaks, 245 m snow line, 20% flora; a 3000x2000x310 m mothership at 2200 m
  and 780x330x120 m harvesters. Three defaults had been pinned at their slider
  maximum, which is the tell that the range ran out before the taste did —
  mother len/wid and ship speed ceilings raised to 5000 m / 3500 m / 60 m/s.
- **Bomb counts** became named constants (they were written twice each, at the
  spawn site and in the initAliens reset, where two copies drift the moment one
  is edited alone). Mothership 10000 -> 40, harvester 100 -> 20, relay 6.
  10000 was never a difficulty setting, it was "unkillable" written as a
  number; 100 was set when hulls were 200 m long rather than 780.
- ⚠️ **A downed hull used to kill you.** `alienBombHits` skipped falling and
  melting hulls; the three player-collision checks right below it only tested
  `.gone`. So the wreck you had just bombed was still lethal all the way down —
  and you are by definition right beside it — while the melting one left an
  invisible killbox at ground level for the 8 s it took to sink. A falling
  mothership, 3000x2000 m sweeping down from 2200 m, made it a certainty. One
  predicate, `hullAlive()`, now guards all three.
- 🧊 **THE FREEZE — and how not to debug one.** Nico reported the game
  freezing when a ship went down: plane stopped, world stopped, *audio kept
  playing*, and no crash overlay. The first diagnosis was wrong: reproducing
  "a wreck crashes you" produced an ALIEN HULL overlay, which is a crash, not
  a freeze, and Nico said so. Audio continuing was the clue that was there all
  along — WebAudio runs off its own thread, so a frozen world with live sound
  means the rAF loop died, not that the flight ended.
  The console from his still-frozen tab gave the answer in one line:
  `Uncaught ReferenceError: camPos is not defined at drawTrail (fx.js:162)`.
  `js/fx.js` used `camPos` without importing it, inside the `kind === 3`
  bomb-detonation-ring branch. In the single-file build `camPos` is a global
  and it works; in the modular build it throws. And `frame()` reschedules
  itself on its LAST line with no try/catch, so one throw meant no next frame,
  ever. **Broken since at least v8.0** (same line, `fx.js:132` there) and
  invisible because the single file is the one people double-click and play.
  Fixed to `viewPos`, which is also what the v7.1 invariant requires: the GPU
  and the 2D overlay must consume the same rotated view. A *hit* on a ship
  consumes the bomb without detonating, so it was the MISSES that froze it.
  Lesson, bluntly: **ask for the console before theorising.** Two wrong
  hypotheses (an expensive melting hull; a crash) were investigated at length
  before the one free piece of evidence was requested.
- **`serve.py`**, and the docs now point at it instead of `python -m
  http.server`. The bare module sends no `Cache-Control` at all, so a refresh
  replays the `js/*.js` already in cache and an edited module looks like it
  changed nothing — which is exactly how the lowered bomb counts appeared not
  to work, and cost a confused test round. It also pins the `.js` MIME type,
  since on Windows `mimetypes` reads the registry where `HKCR\.js` can be
  `text/plain`, and a module served as `text/plain` is refused outright.
- **`test/` exists — ROADMAP C2 started.** `node test/run_tests.js`. The
  module-reference check was written specifically because the `camPos` class
  of bug is invisible in the build people play, and it was **verified to go
  red on the real bug** before being called green.
- ⬅ Deliberately NOT done: the single-file build was left stale. Nico's call —
  "yes accept the difference, C1 will regenerate it".

## Second Claude Code session — 6 September 2026 (ROADMAP C1)

The dual-maintenance ended. `build.js` generates the single file from the
modules, and the modular repo is the single source of truth.

- **Why a generator and not a tidier hand-merge.** Every dud release in this
  project's history (v6_1, v6_2, v8_4, v9_1) came from patching two parallel
  builds by exact string match, and the v9.1b single file shipped missing
  four separate fixes — the tuning-panel overflow fix + COPY JSON, the tuned
  world/fleet defaults and raised ceilings, the bomb constants and
  `hullAlive`, and the `camPos`→`viewPos` freeze fix. All four were verified
  closed in the generated artifact by diffing it against v9.1b.
- **The order is derived, not written down.** The ROADMAP carried a
  hand-verified concatenation order. `build.js` ignores it and walks the
  import graph from `js/main.js` in depth-first post-order, which IS the
  browser's module evaluation order — so the concatenation runs top-level
  code in exactly the sequence the modular build already runs it, and adding
  an import can never silently invalidate a list. (The derived order differs
  from the written one; both are valid topological sorts.)
- **The artifact is an IIFE under `'use strict'`.** The hand-built single
  file was one true global scope — `camPos` was a real global in 20 places,
  which is precisely why the missing `import` in `fx.js` was invisible there
  and froze the modular build. Wrapping the bundle keeps module semantics.
  The leak hazard inside that shared scope is unchanged, so `build.js` runs
  `check_module_refs.py` itself and refuses to build on a leak or on a
  top-level name collision between two modules.
- **`test/test_build.js` is what makes "never edit the artifact" real.** It
  rebuilds in memory and fails unless the committed file is byte-identical.
  Verified red in both directions before being called green: editing a module
  without rebuilding, and hand-editing the artifact.
- 🏷️ **`css/style.css` began with a literal `<style>` line** — a leftover
  from when the CSS was lifted out of the single file, and the discovery of
  the session. CSS is not HTML: the parser reads `<style> * { … }` as one
  invalid qualified rule and discards the prelude *and the block after it*,
  so `* { margin:0; padding:0; box-sizing:border-box }` had been silently
  dead in the modular build for its entire life. Confirmed in the browser
  before touching it (`box-sizing: content-box`, `h1` margin `7.37px 0 10px`,
  85 rules parsed instead of 86), and the start page showed it: PILOT
  overlapping the R-DRAG row, the TUNING panel over the HUD, the ALIENS panel
  clipped off the right edge. It surfaced only because C1 inlined the file
  and produced a visibly nested `<style>`. Removing the line restored
  `border-box` and the intended layout. Worth remembering that the
  tuning-panel overflow hunted the day before was fighting the same missing
  reset from the other end.
- 🔁 **CRLF nearly made the freshness check useless.** `core.autocrlf` is
  true on Windows, so a fresh clone materializes every file as CRLF. One
  `git checkout js/config.js` during testing restored that single 29-line
  file as CRLF and put 28 stray `
` into an otherwise byte-stable
  artifact, so `--check` called a just-written file stale. `build.js` now
  normalizes every source it reads to LF, which also means the artifact is
  identical whatever the working tree holds.
- Both builds were flown to confirm it: the generated single file boots,
  renders, flies, fires and detonates bombs on the ground — the exact
  `kind === 3` branch that froze the modular build — with no console error
  and steady fps; the modular build still flies with the reset restored.
  The artifact was also checked to reference nothing external at all, since
  a double-clicked `file://` page fails every fetch silently.

## A1 — footprint-aware detail fade, 6 September 2026

The shimmer fix, and the first time the shimmer was actually MEASURED rather
than reasoned about.

- **What it does.** Every noise octave now carries its world-space frequency,
  and fades out as it crosses Nyquist for that pixel's ground footprint
  (`px = march distance x uPixScale x detailFade`). Detail that cannot be
  resolved is removed *before* it is sampled instead of being sampled and
  flickering. Colour lattices got the same treatment — the vegetation mottle
  runs at 0.6 cycles/m, a 1.7 m wavelength, so it was already ~4x past Nyquist
  barely 200 m out. That is why the ground sparkled even where the mountains
  sat still.
- **Faded octaves decay toward the octave MEAN, not toward zero.** Toward
  zero, removing detail also lowers the average height, so distant ground
  would sink as you flew at it — a systematic sub-pixel shift across a whole
  silhouette, which reads as the terrain breathing. The two constants are
  measured, not guessed: 400k samples of the real `noise()` gave
  E[noise] = 0.4991 and E[ridged octave] = 0.4475, and E[n*prev] came out at
  0.2006 = 0.4475^2, i.e. successive ridged octaves are independent — so
  fading `n` toward E[n] gets the product right for free.
- **The old fbm/fbmR/ridged are now thin wrappers** passing freq 0, which
  makes every weight exactly 1 and `mix(mean, n, 1.0)` return `n` exactly.
  One loop body each, no second copy to drift — the same reasoning that made
  `terrainShape(p)` simply `terrainShapeLOD(p, 0.0)`.
- ⚠️ **terrainShape stayed full detail on purpose.** It is the collision
  authority: the GPU probe row and the terrain.js mirror both answer with it.
  Verified rather than asserted — the CPU/GPU divergence measured 0.04–0.31 m
  with A1 against 0.02–0.45 m on the pre-A1 shader swapped back in, i.e. the
  same pre-existing fp32-vs-fp64 band and nothing new.
- **How it was measured.** Hover the camera in observation mode (drift under
  0.2 m), patch `gl.readPixels` on the live context to grab a band from inside
  the frame, and patch the `uJitter` uniform — which main.js pins to 0 — to
  shift the sampling grid half a pixel. Shimmer is the mean |delta luma|
  between unshifted and shifted. Two unshifted frames differ by 0.004, so the
  floor is ~0.1% of the signal.
- **The result, and the surprise.** Near field, ground-filling view:
  **−41% mean, −70% median**. Far field: **−3%**. The distribution said why —
  10% of distant pixels carry 59% of the energy, and those are silhouette
  edges flipping hit/miss, which A1 cannot touch by construction. The first
  test view was a high-altitude massif, almost all silhouette, and it read as
  "1%, barely does anything"; the honest answer only appeared after testing
  the scene the complaint was actually about. **A4 is promoted above A2/A3**
  as a result: it is where essentially all the remaining shimmer lives.
- Throughput **+3%** at fade 1 (+6% at fade 2) — detail fading pays for
  itself, as the research predicted. Measure Mpix/s, never fps: the adaptive
  render scaler reacts to fps and hides the effect entirely.
- Cold shader compile is **unchanged** (83.6 s vs 82.9 s). The first
  impression was that A1 had doubled it; that was the driver's program cache,
  which turns the same shader into a 9 s warm reload. Busting the cache key
  with a throwaway comment is how to compare honestly.
- 💥 **A backtick in a GLSL comment cost a debugging round.** Writing
  "the `detail fade` knob" inside shaders.js closed the JS template literal
  early and turned the rest of the shader into stray JS tokens — a blank page
  and `Unexpected identifier 'detail'` in the console. Nothing in the suite
  read the modules as CODE, so it sailed through. `build.js` now parses the
  bundle with `new Function` and refuses to build; verified against the real
  bug before being called green.

## v9.2 — the shimmer hunt, and what it was really about (7–8 Sept 2026)

The longest detour in the project's history, and the most useful thing in it
is the detour itself.

**What was asked:** kill the shimmer (ROADMAP section A). **What was
delivered:** A1 (footprint-aware detail fade), A4 (silhouette stabilization),
A2+A3 (specular AA + shoreline band), A5 (still-camera accumulation), A6
(TAA with reprojection). Every one measured with a purpose-built rig — a
locked camera, `uJitter` shifted half a pixel, mean |delta luma| between the
two frames, with a measurement floor of 0.004 against signals of 2–10.

**What it turned out to be:** the game was rendering **683x359 on an Intel
Iris Xe while an RTX 4090 sat idle at 0% in the same laptop.** Three causes
compounded — the browser defaulted to the iGPU (a per-app GPU preference was
never set, and `powerPreference: 'high-performance'` is only a hint); the fps
counter could not report below 20, so the auto-scaler could not tell 20 fps
from 3 and pinned resolution at its 0.4 floor; and on battery the dGPU sits
at P8 / 210 MHz / 5.5 W against a 3105 MHz maximum. Fix those and the same
code runs at 1706x1495 at 37–45 fps with no visible pixel shifting at all.

Nico put it better than the roadmap did: *"it's the low pixel count (auto, so
about 683x359) that made me see the pixels shifting... We should have started
with talking resolution!"*

- 🧭 **The lesson, stated plainly: ask what resolution and which GPU FIRST.**
  Careful measurement of the wrong thing is still the wrong thing. Every A
  number in docs/RESEARCH.md is honest and was taken on a starved GPU at a
  resolution where the artifacts were real but the cause was not the code.
- ⏱️ **A readout built for a HUD is not an instrument.** The fps counter
  accumulated the CLAMPED physics `dt`, so past 50 ms a frame it read exactly
  1/0.05 = 20 forever. It misled a published cost figure ("2x pixels = 1.6x
  frame time"; the truth is ~1.9x, essentially linear) AND blinded the
  auto-scaler that steers resolution. Nico spotted it from the other side:
  *"it reads 20 but I see it's just a few frames per second, I can almost
  count them."* Fixed; `test/test_render.js` guards it.
- 📈 **Resolution is the strongest antialiasing lever there is**, and the
  only one with no downside: −52% visible shimmer at 2x for 3.7x frame time,
  no blur, no ghosting, nothing to tune. Shipped as the `resolution` knob
  with a RES readout in the HUD, because a slider whose result you cannot see
  is not usable.
- ✂️ **A2–A6 were dropped from the mainline** and v9.2 branches from A1.
  A1 stays because it is a net speedup (+3%) as well as a quality gain. The
  others are on branch `v9.1` with their numbers in RESEARCH.md so nobody
  rebuilds them. On A2+A3 specifically — the water/beach fix, the only one
  visible in a still frame — Nico's verdict was *"the beach fix was ok but
  had some other aliasing issues which made me prefer the older version."*
- 🔌 **A hardware detour worth recording**: the barrel AC adapter is dead
  (confirmed by elimination — USB-C PD charges fine, the ACPI AC-adapter
  device is healthy, the battery is at 75% of design). It matters because on
  battery the dGPU will not leave P8, so graphics work is blocked on a
  replacement. The periodic "hiccup" seen only on the RTX, on both builds,
  vanished after a reboot and was never reproduced by frame-time sampling
  (zero spikes above 1.8x median). The only world-state teleport found was
  jul's ring recycler moving a ring ~4 km on a ~4 s cadence — `js/rings.js`,
  untouched by every A-commit.
- Also fixed on the way: `test_docs.js` now normalizes line endings. With
  `core.autocrlf` on, a bare `git checkout -b` re-materialized the docs as
  CRLF and every regex anchored on a newline stopped matching — the same trap
  `build.js` already guards with `read()`.

## v9.3 — testing the tests, and a blue fleet (9 Sept 2026)

Started as "check the repo and tell me the next steps". The first
`node test/run_tests.js` printed **`1 suite(s) FAILED` while every single
assertion printed `ok`** — which is why nobody had noticed it.

### The flake, and what it was really saying

`crashedAt()` in `test_aliens.js` parked the craft on `ships[0]`, marked the
hull falling, and asserted no crash. But `initAliens()` drops **two**
harvesters on independent random plains spots, and the harvester box is
780 × 330 × 120 m. Measured over 3000 runs: **21 (0.7%)** land within
57..408 m of each other, and the craft parked on the inert `ships[0]` is then
inside the still-live `ships[1]`. The crash was real; it just came from the
neighbour. At suite level that surfaced ~5% of the time. `crashedAt` now
displaces every other hull before the update.

`hullAlive()` was never wrong. The test was.

### Two assertions that were passing for the wrong reason

Found by breaking the source deliberately, which is now `test/mutants.js`:

- **The A1 octave-fade check had never tested `fbmLOD`.** It sliced each
  shader function with a fixed 700-char window; `fbmLOD`'s body is ~413
  chars, so the window ran on into `fbmRLOD`. Fading `fbmLOD` toward `0.0` —
  precisely the "distant ground sinks as you fly at it" bug the comment
  describes — left all four assertions green, answered by the neighbour's
  `mix()`.
- **"A MELTING hull is inert" passed with `melt` deleted from `hullAlive`
  entirely**, because a melting hull *sinks*, sliding out from under a craft
  parked at its pre-update position. It was testing displacement, not
  inertness. `crashedAt` now follows the hull for 8 frames.

The same mistake then appeared in the terrain test being written to fix it:
regexes scanning the whole shader were answered by `terrainCheapH()`, a
**third** copy of the shaping maths (shadow rays) that nothing had ever
guarded. Scoping to one function body fixed it and added a check that the
cheap variant still shares the main body's constants.

**Lesson, and it is the one worth keeping: a passing assertion is not
evidence that it tests anything.** Only breaking the code it names proves it.

### `test/test_terrain.js` — the last hole in the collision path

`terrain.js` is the fp64 CPU mirror of `terrainShape`, read by ring placement,
alien placement and the camera clamp, and it had **zero** coverage. Three
angles, because none alone is enough: golden heights under a *pinned* TUNE
stub (retuning the world is routine and must not false-red it); constants
compared **numerically** against the GLSL, since the shader writes `1.0e-4`
where the mirror writes `1e-4`; and the derived ones reconstructed — the
shader's `smoothstep(0.58, 0.72, v)` survives in the mirror only as a `0.14`
span, so it asserts `0.58 + 0.14 === 0.72`. 12 mutants, from both sides.

### The fleet turns blue, and bombs land on hulls

Nico's tuning values, and the fluo-green/violet palette moved to blue —
hulls, seams, relay, harvest sheet. Melt stays orange as the only warm thing
left on a hull, so damage reads at a glance.

Bomb hits on hulls got their own treatment. The ring is drawn **on the face
it struck**: `aliens.js` resolves the face in hull-local space and `fx.js`
re-derives it in world space every frame, so it wraps a flank and *rides* a
moving harvester (at 30 m/s a static ring drifts 24 m off the ship inside its
own 0.8 s life). The face is chosen in **half-extents, not metres** — a bomb
landing on a 1200 m deck 300 m forward of centre is 300 m along the length
and 59 m up the height, so metres pick the nose and draw the ring hanging in
the air beside the ship.

The first attempt at a hull detonation sound was wrong in an instructive way:
it took `explosionSound()` and moved every frequency down, keeping the
architecture — noise burst under a sweeping lowpass, plus a sine drop. Nico:
*"the sound is still the same bomb sound I think"*. He was right. Shifting
pitch does not change timbre. What separates hitting a hull from hitting dirt
is **resonance**: soil is broadband and dead, a big hollow metal box rings.
Rebuilt around two high-Q bandpass bands ringing over a deep sub, with the
bright crack removed entirely.

### Energy beams move into the shader

*"The lasers are seen through the mountains and hulls."* They were 2D lines
on the fx overlay, which has no depth buffer. Moved into the fragment shader,
where the ray's closest approach to the beam segment is compared against the
primary hit — occlusion against terrain, hulls and trees for free. The 48 fx
occlusion probe slots were already fully allocated (trail 16, bullets 8,
bombs 3, pops 10, impacts 11), so sampling the beam was not an option, and a
single visibility value would have made the whole beam blink.

Only `(source, head, tail, fade)` is uploaded — one vec4 instead of six
floats, because `uShipPos`/`uRelay`/`uMotherPos` already hold the geometry.
That also welds a beam to a harvester still in motion.

Moving them exposed a leak: `drawBolts()` had been the only thing splicing
spent bolts out of `alien.bolts`.

### Relay

5× base (150 m), growing to 7× that — about 35× the old bulb. The growth
increment is now derived from `GROW`/`STEPS` so resizing cannot silently
change the 50-arrival pacing of the invasion economy.

### The backtick trap, live

Writing `` `t` `` in a GLSL comment ended the JS template early. `build.js`
named it instantly and `test_shader.js` counted 6 backticks where 4 belong.
The v9.1 gotcha, catching a fresh instance of itself.

## v9.4 — the marcher, and what measurement kept overturning (10–12 Sept 2026)

The session Nico opened by pointing at a screenshot and saying the thing that
had bothered him for weeks: *"I think it's a graphic issue with lines like
mountain ridges, sand-water line, mushroom-tree borders that are 'shifting'
and moving along when there is movement."* Then, crucially, he stopped the
usual reflex: *"Don't act yet, I want to discuss this so we know what we're
doing to fix it."*

**The artifact was real, and it was geometric.** Concentric rings centred on
the viewer, thirty or forty of them out to the horizon, riding along with the
camera and making every silhouette crawl. It survived 2x supersampling — which
is what proved it was not aliasing: A1's LOD fade, the flora range circle and
the detail-fade knob were each ruled out by a test Nico flew himself.

**What it was:** the terrain hit tolerance `0.01 + 0.0015 * t` is a distance
along the ray, and converting it to a vertical error divides by the sine of
the incidence angle. At a grazing 1.5° that is a 38x amplification, so the ray
stopped a long way above the ground it was supposed to hit — and because `t`
grows in steps, the stopping error is quantised into shells. The rings were
iso-surfaces of the tolerance itself.

The fix is one `max`:

```glsl
float inc = mix(1.0, max(abs(rd.y), 0.06), uRayTol);
if (dT < tolRay * inc || dP < tolRay) { ... }
```

Measured across 900 rays through a shoreline at two altitudes: **mean hit
error down 10.6x, p99 down 16x.** Numbers and method in RESEARCH.md §5.

- 🔬 **The method changed partway through, at Nico's suggestion, and that is
  what made it work.** *"as these artifacts are quite hard to see well, I'd
  suggest that you ask me to do the visual tests you want and I do the fly by
  and screenshots, what do you say?"* Six false-colour debug channels
  (`uDebugMask`, a bitmask) were built so he could photograph march steps, hit
  distance, footprint, terrain height, normal turn and colour LOD. The
  `dbg distance` view is what localised it: *"the concentric line just ahead
  of the plane, shifts quite a lot in the mountains... I think that's the
  'creeping' I can see."* Those channels shipped — the whole Debug panel did,
  on his call: *"we're going to keep the whole debug panel, it's fun to
  tweak."*
- 🦄 **Two things that looked like the same bug were not bugs at all.** The
  wiggly coastline is real fractal geometry: the shoreline's own deviation
  from a straight line is 8.4 m RMS measured over a 20 m span and 107 m over
  1 km, because a 2.35% beach slope turns every vertical metre of terrain
  noise into 43 m of horizontal shoreline movement. And the land/water
  boundary is not misplaced: **0 of 72,600 pixel rays** classified land vs
  water differently from a 4000-iteration reference march. What remains is
  irreducible — one ray per pixel means a boundary flips sub-pixel, and the
  only cures are more samples or exact geometry. Nico got there himself:
  *"I'm starting to wonder if I'm chasing something impossible due to
  inherent design of the game."* Largely, yes — and that framed v10.
- 🐴 **The horns.** Rounded hull corners grew spikes, and the cause was the
  same family: a ray nearly tangent to a large flat face needs many tiny
  steps, and the box march had **48 iterations**. 18.8% of rays that really
  hit the mothership were running out of budget. Raising both box marches to
  384 took it to 1.3%. **The fix I proposed first — step relaxation — measured
  WORSE** (390 misses against 365), so it was killed by its own measurement
  rather than shipped on plausibility.
- ⚠️ **Three of my own conclusions were overturned by measuring them, and all
  three are worth recording because reasoning had been confident:**
  - I ruled out `terrainNormal`'s epsilon by measuring it on a **flat beach**,
    where it swings 0%. On a ridge it swings 19.7%. A null result from an
    unrepresentative sample is not a null result.
  - I reported a compile-time regression of 212 s from the raised iteration
    caps, off a single uncontrolled reading. A controlled A/B showed the
    **original** caps at 243 s — the caps were not the cause and the
    "regression" did not exist.
  - ROADMAP **A4** (bisection refinement of the hit point) is in the backlog
    as a silhouette fix. Implemented and measured here, it improved the hit
    error by **1.0x** — exactly nothing. Recorded as a null result so nobody
    builds it again.
- 🚫 **I broke Nico's live test and he caught it.** To take an A/B reading I
  temporarily reverted the iteration caps and rebuilt — while he was flying
  the served tree. His reload picked up the reverted build and the horns came
  back: *"Did you do a temp change for a test, and then reverted?"* The tree
  being served is the tree being tested. **Warn before touching it, or use a
  worktree.** Nothing in the code guards this; it is a process rule.
- 🎛️ Also shipped: footprint-aware water ripples (the sea's sparkle is a
  Nyquist crossing between wave wavelength and pixel footprint, faded out by
  footprint and the specular exponent dropped 260→30 with it — *"the water LOD
  does fix the sparkling water, very cool... superb"*); energy beams moved
  from the 2D overlay into the shader so they are depth-tested and no longer
  draw through mountains; the fleet turned blue; bomb rings that follow the
  struck hull face instead of billboarding at the camera; rounded hull corners
  at 45% with collision that follows the fillet; the relay 5x bigger, growing
  to ~35x and deflating over 2 s with its beam lit; and a melt tail that keeps
  wrecks on the ground as dark embers for ~116 s instead of blinking out in 8.
- 🏆 A `HARVESTERS` counter, and `INVADERS DEFEATED` in its place when the
  whole invasion is gone. The full spreading invasion — 8 harvesters spawning
  a second relay, 4 relays duplicating the mothership — was **specified, costed
  and deliberately dropped**: it needs the fleet in a texture instead of
  ~168 more uniform slots against a 260 ceiling. Nico: *"we drop for now the
  full invasion with multiple relays and motherships. Document it for later,
  but let's drop that complexity now."* It is ROADMAP C3, and v10's rasteriser
  may delete that renderer anyway.
- 🧪 The suite went from 67 assertions in 9 files to 73 in 10, and the
  mutation battery from 29 mutants to 36. `test/test_panels.js` is new and was
  born failing the wrong way: the first version of it passed, and the mutation
  battery showed its headline mutant **escaping** — the round-trip it drove
  could never reach the branch that broke, because `armMaster()` prevents it.
  The assertion was rewritten to test the guard as the defence it is. That is
  the whole argument for the battery in one incident.

## The third marcher pass — "fix me that thing" (12 Sept 2026, evening)

Nico, after the v9.4 wrap had declared the beach flutter irreducible: *"I'm
pretty sure that the same mechanism that made the 'horns' in the rounded
borders are what I see in the unnatural 'spike' movements of the water on
the beach. Same for the mountain ridge 'shifting'. In short these are things
that should not fluctuate... fix me that thing that makes this beautiful 3D
world have some fluctuations of what should be fixed."*

**He was right and the wrap was wrong.** RESEARCH §5.3 had measured the
terrain march over a beach *fan*, found no budget exhaustion, and generalised
that to ridges and the waterline — the same mistake as the flat-beach normal
test recorded two sections earlier. Re-checking §5.4 found its ALT 226 m
camera underground in two of three scenes. Measured properly (full pixel
grids, camera moved one frame, flips counted *above a reference march's own
parallax*): the terrain march ran out of its 150 iterations on 49 rays over
a beach at 3° and returned −1, which the material pass drew as **sea**
wherever the ray had crossed the water plane. Spikes of water into the sand,
a different set every frame. The horns, exactly.

- 🕳️ **Three movers, each measured**: budget exhaustion as a hole; the
  0.0018·t minimum stride hopping berms (hit lands up to 45 m further along);
  the tolerance stop's residual (1.2 m at 4 km) keying every altitude band
  43 m sideways on a 2.35% beach. Two suspects cleared by the same rig:
  texture boil (all parallax) and shadow acne (12% of sunlit land wrongly
  black at grazing views — real, but static). RESEARCH §6.
- 🔧 **The fix, chosen by sweep**: 384 iterations and exhaustion returns
  the surface; the stride is a knob at 0.0009; a secant refine onto the
  surface that only extrapolates while the gap is shrinking. Sea scene flips
  15 → 4 with the reference at 4; holes 49 → 0; residual 0.24 → 0.07 m.
- 🧬 **The most useful number of the day was a bad one.** The first version
  cost **+65% frame time for +17% iterations**. The refine was a block after
  the loop with four terrain evaluations of its own; GLSL inlines every call,
  and five copies of the largest function in the shader made the whole loop
  slower per iteration. As phases *of* the loop — one call site — the same
  maths costs +14%. Two traps recorded with it: an fps of ~165 here is the
  165 Hz panel (the first "old" reading was vsync), and observation hover has
  inertia (a "still" capture right after a nudge is the glide).
- 🌳 **The trees were doing it on purpose.** `plantEval` shrinks every tree
  to 35% by 4 km — v4.6's "exaggerated perspective" — which is precisely a
  form that changes as you fly past. Now `tree persp`, default off.
- Suite 72 assertions / 11 files; battery 41/41. Version strings left at
  v9.4 — the bump is Nico's call. (Bumped to v9.5 the next morning.)

**13 Sept, the peaks.** Nico flew v9.5: *"it's great the coast issue is
fixed, it worked!"* — and then sent 18 screenshots of a peak that went
pointy → rounded → pointy *in a loop* as he advanced one arrow-tap at a
time. *"I am 99% positive that it's the same glitch as the beach one, and
the rounded borders one."* He was right a fourth time, and the word "loop"
was the key: parallax is monotonic, a cycle is the march. Five frame-level
hypotheses were tested and cleared first (march accuracy at cliff feet,
sub-metre roughness of the mountain front, fp32 precision, shadow flicker,
crease sharpness); a 1D camera-slide rig on the 36 hardest rays then found
the shipped march losing and re-finding the crest 56 times where the
reference never did. Nine remedies measured; the one that scaled was the
**minimum stride floor** — 0.0009 → 0.0002, flips 84 → 19, +16–23%
iterations — and the theory everyone (including the rig's author) believed
first, along-ray sample phase, measured at 15 flips in 2 916 and took a
world-anchored-lattice idea down with it. A refine-bound regression the
smaller floor exposed (beach residual 0.05 → 0.34 m) was caught by the rig
before it shipped and pinned with a mutant. Also today: a POS readout and a
URL teleport, so the next glitch travels as a link. RESEARCH §6.7.

**13 Sept, afternoon — the switches, and the camera.** Nico: *"Putting the
invasion and rings to none, does nothing, those peaks that shift, still
shift. I know it's not related to other elements of the game... it's
something around the camera view, and the terrain itself."* Two Debug
switches had been built for exactly that question (`invasion`, `rings`:
hulls, beams, collisions and the ring course gone, the economy still
ticking) and they answered it. Then the render was checked at the *exact*
camera: the pane flew his teleport, ten backward taps, and per capture read
back `uCamPos`/`uCamMat` from the program together with the ridge row of
177 columns. On the fp64 mirror at those cameras the shipped march and an
8 000-iteration reference agree to **1 px on every column, all six
captures**; the GPU agrees with fp64 to ≤3 px on 87–94% of columns, and at
his peak the difference is a constant −2…−5 px from capture to capture.
What did move was the camera: 1.5 s after a tap it is pitched **11.14°**
down, at 3 s **10.80°** — 0.34° (~6 px on his screen) still to go — and
after a teleport it swings in yaw for ~6 s. So a third switch, `obs
camera`: **snap** parks the chase camera at the springs' own rest pose
every frame (`chasePose()`, which the v8.5 instant Y-off already computed
inline and now shares), **freeze** leaves it where it is while the craft
moves. If the peak still breathes under `snap`, the camera is cleared and
the render is back on the table; if it stops, it was the glide. Nico flies
the verdict. `test_flight.js` pins the solver to the camera measured live
(15.7 m back, 8.5 m up, 10.56° down) and to the fixed-point equations; the
12-rounds → 1 mutant verified red by hand. The mutation battery was not
re-run on this commit — the laptop was at 5%. RESEARCH §6.8.

## Lessons that shaped the tooling

- Exact-string patching of two parallel builds repeatedly broke on VERSION-
  COMMENT DRIFT (bumps rewrote strings inside anchors) → several dud
  releases (v6_1, v6_2, v8_4, v9_1). Claude Code + git diffs is the cure;
  also: make the single file a build artifact — done 6 Sept 2026, `build.js`.
- Every mechanic got a Node harness evaluating the REAL module with stubbed
  imports; they caught ~6 would-be shipped bugs. Port to test/ (ROADMAP C2).
- `bash pipefail`: piping tests through `tail` masked failures once and a
  broken build got packaged before the tests were re-read.
- The outputs mount forbids overwrite/delete → every fix shipped under a
  new filename (the b-suffix convention).
