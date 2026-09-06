# Fractal Alps — Mandelbrot Flight v9.1

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

The start page shows load progress (the long step is the driver compiling
the ~800-line world shader), lets you set a pilot name and the craft's wing
accent color (both remembered), and arms START once the GPU has drawn its
first frame.

## Running

The game uses ES modules, so it MUST be served over HTTP — double-clicking
`index.html` will not work (browsers block module loading from `file://`;
the page now tells you so instead of loading forever). The single-file build
is the double-click-friendly variant:

```sh
python3 -m http.server 8734
# then open http://localhost:8734/
```

Note for mobile: browsers only expose motion sensors (TILT mode) on secure
origins — serve over HTTPS, or use `adb reverse` so the phone sees
`localhost`. Vanadium/GrapheneOS additionally blocks motion sensors per
site setting by default.

## Structure

```
index.html          Markup only: canvas, HUD, tune panel, touch UI, overlays
css/style.css       All styling, including touch-only UI (body.touch)
js/
  main.js           Entry point: wiring, the rAF loop, uniform upload + GPU probe readback
  config.js         Shared constants (FOV, water level, weapon/ring/cloud limits)
  state.js          Central mutable game state (craft, camera, sun, crash flag, probe)
  math.js           Vector helpers (normalize/cross/Rodrigues rotation)
  flight.js         6DOF flight model, chase camera, grind-then-crash contact
  input.js          Keyboard, mouse (fire/bomb/sun), joystick, touch buttons, gyro tilt
  rings.js          Ring course: land-seeking spawning, pass-through scoring (jul)
  spores.js         Tree harvesting: score + the 512x512 collected-cells texture
  weapons.js        Guns (8 tracer slots) and bombs (GPU-authoritative detonation)
  clouds.js         Cumulonimbus placement + wind drift
  fx.js             2D overlay: contrails, tracers, blast rings, harvest pops
  audio.js          All synthesized sound (engine, grind, weapons, chime, crash)
  terrain.js        CPU terrain height mirror of the GPU terrainShape (tune-aware)
  hud.js            HUD readouts, crash overlay, toast messages
  shaders.js        GLSL vertex + fragment shader sources
  renderer.js       WebGL2 setup, uniform locations, resize, adaptive render scale
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
- Ring material in the shader is `mat == 5` (4 is plants, 3 the aircraft).
- `window.__fractalFlight` is a console debug handle exposing live state.
