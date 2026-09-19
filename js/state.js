// Central mutable game state. Modules mutate these objects in place;
// none of the bindings are ever reassigned.

import { START } from './config.js';

export const craft = {
  pos: [START.x, START.y, START.z],
  // v4.0 FREE FLIGHT: orientation is an orthonormal triad (right/up/fwd)
  // rotated incrementally in the craft's own body frame — no Euler angles,
  // no gimbal lock. Loops, rolls, and inverted flight all just work.
  r: [-1, 0, 0], u: [0, 1, 0], f: [0, 0, 1],
  rollVel: 0, pitchVel: 0,     // smoothed angular rates (rad/s)
  speed: 90
};
export function craftB() {
  return { right: craft.r, up: craft.u, fwd: craft.f,
           mat: new Float32Array([...craft.r, ...craft.u, ...craft.f]) };
}

export const camPos = [craft.pos[0], craft.pos[1] + 6, craft.pos[2] - 18];
// the RENDERED camera position: chase camera + mouse orbit (flight.js fills
// it every frame; renderer upload AND 2D overlay projection both read it)
export const viewPos = [camPos[0], camPos[1], camPos[2]];
// wheel-zoom target (input.js writes, flight.js eases) + pilot-view flag
export const viewZoom = { t: 1, cockpit: 0 };
// camera modes: Y toggles free (mouse orbit + wheel zoom), X toggles pilot view
export const camMode = { free: false, pilot: false, obs: false };
// cockpit gaze basis: when on, guns/bombs fire along the pilot's view
export const pilotAim = { on: 0, fwd: [0, 0, 1], right: [-1, 0, 0], up: [0, 1, 0] };
export const sun = { az: 2.55, el: 0.20 };   // low sun -> long shadows

export const flags = { crashed: false };

// GPU collision probe answers (decoded each frame in main.js; one frame of
// latency — probe.pos is the craft position the current values answer for)
export const probe = { ground: null, plantD: 99, pos: [0, 0, 0] };

// Player laser (v9.9). `holding` spans the right-button press, `charged` flips
// once the hold passes LASER_CHARGE_MS, `shot` holds the drawn beam for ~0.4 s.
// Mutated in place like everything else here, never reassigned.
export const laser = { holding: false, holdT0: 0, charged: false, shot: null };
