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

## Lessons that shaped the tooling

- Exact-string patching of two parallel builds repeatedly broke on VERSION-
  COMMENT DRIFT (bumps rewrote strings inside anchors) → several dud
  releases (v6_1, v6_2, v8_4, v9_1). Claude Code + git diffs is the cure;
  also: make the single file a build artifact (ROADMAP C1).
- Every mechanic got a Node harness evaluating the REAL module with stubbed
  imports; they caught ~6 would-be shipped bugs. Port to test/ (ROADMAP C2).
- `bash pipefail`: piping tests through `tail` masked failures once and a
  broken build got packaged before the tests were re-read.
- The outputs mount forbids overwrite/delete → every fix shipped under a
  new filename (the b-suffix convention).
