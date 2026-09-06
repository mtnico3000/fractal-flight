# Fractal Alps — Mandelbrot Flight (CLAUDE.md)

WebGL2 raymarched flight game over a Mandelbrot-shaped island. No meshes, no
textures: every pixel sphere-traces a procedural world each frame. Two-player
"ping-pong" development between Nico (mtnico3000) and jul (julaub) — code
volleys via PRs on github.com/julaub/fractal-flight. Current version: v9.1.

## Builds — IMPORTANT

Two parallel builds exist and must stay in sync:
- **Modular** (this repo): index.html + css/style.css + 18 js/ modules. ES
  modules → MUST be served over HTTP (`python3 -m http.server 8734`);
  file:// shows an explanatory watchdog message instead of loading.
- **Single-file** (`fractal-flight-vX_Y.html`): everything inlined, works by
  double-click. Same code with small naming differences (see Gotchas).

Recommended first task in Claude Code: make the modular repo the single
source of truth and generate the single file with a build script, ending the
dual-maintenance. Until then, every change lands in BOTH builds.

## Architecture map (js/)

- `main.js` — boot (async shader compile w/ KHR_parallel_shader_compile,
  start page, pilot name/livery), the rAF loop, ALL uniform uploads, the
  probe readback, fx canvas draw calls.
- `shaders.js` — vsSrc/fsSrc template strings. The fragment shader IS the
  game world: terrainShape (2× mandelDE + domain-warped ridged fbm + lakes),
  plantEval (tree-fern SDF, Julia-carved fronds), clouds, water, craft SDF,
  rings (mat 5), alien fleet (mat 6: box-cropped rectangular mandelbox ships;
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
  pops, alien energy bolts. Occlusion via GPU probe queries (48 slots).
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
- **Single vs modular naming**: single file uses `gpuGround/gpuPlantD` and
  module-scope drawTrail(camB, now); modular uses `probe.ground/probe.plantD`
  and drawTrail(..., bullets, bombs, impacts).
- **Vars used by the camera must not be declared inside the flight-physics
  branch** (observation mode skips it): rollFree, groundH, b are hoisted.
- **uniform budget**: ~260 vec4 slots used. Desktop fine; weakest mobile
  GPUs (min guarantee 224) may fail to link since the alien fleet was added.
- **fp32 terrain quantization**: don't move MB_CENTER/MB_SCALE without
  updating BOTH shader constants and terrain.js literals.
- **Trees**: plantEval must match its collision-probe usage (probes pass
  march-distance 0 = full size; rendering shrinks with distance ≥550m).
- The tune sliders ARE gameplay-affecting (terrain mirror reads them), so
  rings/aliens/camera adapt live.

## Testing conventions (from the Cowork sessions)

Every mechanic was verified with Node harnesses that eval the real module
source with stubbed imports (see the pattern: strip `^import` lines, strip
`export `, `new Function(...stubNames, src + 'return {...}')`). Worth
porting into a `test/` folder with npm scripts. GLSL is checked with
@shaderfrog/glsl-parser (function-like #define macros produce ignorable
warnings). jsdom smoke-loads the whole module graph (matchMedia needs a
stub; don't override Node's `performance`).

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
invasion + observation mode. Current: v9.1.
