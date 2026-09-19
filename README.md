# Fractal Alps — Mandelbrot Flight v9.9

A WebGL2 raymarched flight game over Mandelbrot-shaped mountains — the merge
of both branches of the ping-pong: jul's ring course on top of the v4.6
feature line (6DOF free flight, spore harvesting, guns & bombs, clouds,
synthesized audio, live tuning panel).

Fly through rings to score RINGS; fly through glowing alien trees (or shoot /
bomb them) to score SPORES. Works with keyboard + mouse (desktop) and touch /
gyroscope tilt (mobile).

## Controls

Desktop: A/D bank-steer (max ~49°, springs back level on release), W/S
pitch (hold S for a loop). Hold SPACE for full free-flight mode: free roll
rate, no auto-leveling — barrel rolls, knife-edge, inverted cruising.
Q/E altitude, SHIFT boost, LEFT-CLICK fire (hold = burst), RIGHT-CLICK drop bomb,
RIGHT-DRAG move the sun, R reset, M mute.

Mobile: virtual stick (steer + pitch), TILT toggles gyro steering, on-screen
BOOST / FIRE / BOMB / altitude buttons, drag the sky to move the sun.

The TUNING panel's `resolution` knob is the strongest image-quality control:
`auto` follows the adaptive scaler, while anything above 1.0 supersamples (the
oversized buffer is downsampled on composite). Measured at 2x it removes about
half the visible shimmer for roughly 3.7x the frame time; the HUD's RES
readout shows what you are actually rendering.

⚠️ If it looks blocky and RES is small, check WHICH GPU your browser picked —
on a laptop it usually defaults to the integrated one. See docs/RESEARCH.md §3.

The start page shows load progress (the long step is the driver compiling
the ~800-line world shader), lets you set a pilot name and the craft's wing
accent color (both remembered), and arms START once the GPU has drawn its
first frame.

## Running

Two ways to play:

⚡ **On a laptop, double-clicking may land on the integrated GPU.** The
browser chooses its adapter when its GPU process starts, before the page
exists, so a page cannot change it — `powerPreference: 'high-performance'` is
only a hint and Windows hybrid laptops routinely ignore it. Measured here: the
same build ran 1707x932 on an RTX 4090 and was pinned to the renderer's
683x359 floor on the Intel iGPU in the same machine. **The start page now says
so when it happens.** To force the discrete GPU without changing anything
permanently:

```
.\launch-rtx.ps1
```

It launches Chrome with `--force-high-performance-gpu` and a THROWAWAY profile
(`--user-data-dir`), which is not optional: Chrome is single-instance per
profile, so with one already running a plain launch hands over the URL and
discards every flag. The temp profile is deleted when you close the window —
no registry write, no change to your real Chrome profile.

- **`fractal-flight-v9_9.html`** — double-click it. One self-contained file,
  no server, nothing to install. This is the build to send someone.
- **This repo** — the modular source. It uses ES modules, so it MUST be
  served over HTTP; double-clicking `index.html` will not work (browsers
  block module loading from `file://`, and the page says so rather than
  spinning forever):

```sh
python3 serve.py 8734
# then open http://localhost:8734/
```

### Debug builds

The Debug panel and the shader's false-colour diagnostic channels are NOT in
the normal game. They live in `js/debug.js`, which is loaded by exactly one
dynamic import, guarded by `DEBUG_BUILD` in `js/dbgflag.js` — `false` on disk.
Start the server with `--debug` and it serves that one file as `true`:

```sh
python3 serve.py 8734 --debug
```

Nothing on disk changes, so `git status` stays clean either way. Two things
follow from the split, both deliberate:

- **The double-click build never has any of it.** `build.js` resolves static
  imports only and cuts the one dynamic import, so `debug.js` cannot reach the
  artifact. `test/test_build.js` fails if it ever does.
- **The shipped shader is much faster to compile.** Two of the diagnostic
  channels evaluate the terrain (8 terrain evaluations once GLSL inlines them,
  ~31% of the whole program), and leaving them out roughly halves the driver
  compile at load: ~92 s → ~47 s, measured. See `docs/COMPILE.md`.

On Windows PowerShell 5.1 (the shell this is developed on) use `python`,
and note that `&&` is a parser error there -- chain with `;`, or
`; if ($?) { ... }` to run the second command only if the first succeeded.

`serve.py` is `python -m http.server` plus one header: `Cache-Control:
no-store`. Use it rather than the bare module — `http.server` sends no
cache header at all, so a normal refresh replays the `js/*.js` the browser
already has, and an edited module looks like it changed nothing. (If you do
use the bare server, Ctrl+Shift+R, or tick "Disable Cache" in the devtools
Network panel.) One-off when switching: `no-store` on new responses does not
evict what the OLD server already put in the cache, so hard-reload once.

Note for mobile: browsers only expose motion sensors (TILT mode) on secure
origins — serve over HTTPS, or use `adb reverse` so the phone sees
`localhost`. Vanadium/GrapheneOS additionally blocks motion sensors per
site setting by default.

## Building the single file

The modular source is the single source of truth. The single-file build is a
**generated artifact — never edit it**:

```sh
node build.js
```

It resolves the import graph from `js/main.js`, emits the modules in the
browser's own evaluation order, strips the `import`/`export` syntax, inlines
`css/style.css`, and wraps the result in an IIFE with `'use strict'` so the
one-file build keeps module semantics. It refuses to build if two modules
declare the same top-level name, if an imported name is not actually
exported, or if `check_module_refs.py` finds a cross-module reference that
was never imported.

Run it after any change to `js/`, `css/` or `index.html`, and commit the
result. `node test/run_tests.js` fails if you forget — the two builds drifted
for a whole version line back when both were maintained by hand.

## Structure

```
index.html          Markup only: canvas, HUD, both tune panels, touch UI, overlays
css/style.css       All styling, including touch-only UI (body.touch)
build.js            Generates the single-file build from the modules (see Building)
serve.py            Dev server: http.server + Cache-Control: no-store (see Running)
launch-rtx.ps1      Opens the build in Chrome on the DISCRETE GPU, changing nothing
fractal-flight-v9_9.html   GENERATED by build.js -- the double-click build. Never edit.
js/
  main.js           Entry point: wiring, the rAF loop, uniform upload + GPU probe readback
  config.js         Shared constants (FOV, water level, weapon/ring/cloud limits)
  state.js          Central mutable game state (craft, camera, sun, crash flag, probe)
  math.js           Vector helpers (normalize/cross/Rodrigues rotation)
  flight.js         6DOF flight model, chase camera + orbit/cockpit/observation, crash contact
  input.js          Keyboard, mouse (fire/bomb/laser, middle-drag sun), joystick, touch, gyro
  rings.js          Ring course: land-seeking spawning, pass-through scoring (jul)
  spores.js         Tree harvesting: score + the 512x512 collected-cells texture
  energy.js         The ENERGY pool: rings +100, trees +1, a laser shot spends 100
  laser.js          Player laser: 2 s charge on the right button, JS aim raycast
  weapons.js        Guns (8 tracer slots) and bombs (GPU-authoritative detonation)
  aliens.js         Invasion economy: mothership, harvesters, laser sweeps, relay, bomb hp
  clouds.js         Cumulonimbus placement + wind drift
  fx.js             2D overlay: contrails, tracers, blast rings, harvest pops, energy bolts
  audio.js          All synthesized sound (engine, grind, weapons, chime, crash)
  terrain.js        CPU terrain height mirror of the GPU terrainShape (tune-aware)
  hud.js            HUD readouts, crash overlay, toast messages
  tune.js           TUNE (world) + TUNEA (alien fleet) sliders, RESET and COPY JSON
  dbg.js            The render settings the game reads (shipped defaults; no panel needed)
  dbgflag.js        DEBUG_BUILD -- false, unless serve.py --debug serves it as true
  debug.js          THE DEBUG BUILD: knob table, Debug panel, shader false-colour channels.
                    Loaded by one dynamic import, and only in a --debug run. Never in the
                    single-file build -- see Debug builds below.
  shaders.js        GLSL vertex + fragment shader sources -- the world lives here
  renderer.js       WebGL2 setup, uniform locations, resize, adaptive render scale
test/               node test/run_tests.js -- see Tests below
docs/               HISTORY.md (why), RESEARCH.md (findings), ROADMAP.md (what next)
```

Conventions worth knowing before editing:

- Input sources (keyboard / joystick / gyro) each write to their own state
  object in `input.js`; `flight.js` sums and clamps them. To add a new input
  (e.g. gamepad), write into a new object and add it to the sums.
- `terrain.js` must stay numerically in sync with `terrainShape()` in
  `shaders.js` — it places rings and clouds. It reads the live TUNE values,
  so tuned worlds stay consistent.
- Collision is GPU-authoritative: the bottom-left pixel row of every frame
  encodes terrain height / plant distance at the craft, every bullet, every
  bomb and up to 64 blast-query cells; `main.js` reads it back in one
  readPixels. The JS terrain mirror only bridges the first frame.
- Ring material in the shader is `mat == 5` (4 is plants, 3 the aircraft);
  `mat == 6` is the alien fleet, with `mal.y` selecting mothership / harvester
  / relay.
- ⚠️ **Import everything you use.** A name another module exports can be
  referenced with no import and still work in the single-file build, which
  concatenates every module into one shared scope — and throw
  `ReferenceError` in this one. That froze the game for two versions (see
  docs/HISTORY.md). `python test/check_module_refs.py` catches it; it runs as
  part of the suite and `build.js` refuses to build without it.
- The frame loop reschedules itself on its last line with no try/catch, so an
  uncaught throw stops the world permanently while the audio keeps playing.
  If someone reports a "freeze", read the browser console first.
- `window.__fractalFlight` is a console debug handle exposing live state.

## Tests

```sh
node test/run_tests.js
```

No framework and no browser — the harness evaluates the real `js/` modules
with stubbed imports. **54 assertions across 9 files.** Seven of the nine need
nothing installed; two are dev-only and skip themselves with a note if you have
not run `npm install`:

```sh
npm install       # optional: @shaderfrog/glsl-parser + jsdom, for 2 of the 9
```

The GAME still has zero dependencies and always will — `test_build.js` requires
the shipped single-file artifact to fetch nothing, because it runs from a
double-clicked `file://` page. Nothing in `node_modules` reaches the browser.

Covered: the alien bomb economy and hull states, the bomb-ring
geometry, the invasion pacing, the tuning-panel invariants, shader-source
invariants, the CPU terrain mirror against the GLSL it mirrors, the shader
parsed as real GLSL (syntax, misspelled calls, uniform budget), the whole
module graph booted in a DOM, README/CLAUDE.md drift, a check that no module
references another module's exports without importing them, and a check that
the committed single-file build is exactly what `build.js` generates.

```sh
node test/mutants.js     # slow, opt-in: are the tests testing anything?
```

Breaks the source on purpose, one bug at a time, and requires every test to
go red. Two assertions were found passing for the wrong reason this way — see
the header of `test/mutants.js`. Run it after adding or changing a test.
