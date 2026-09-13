// v4.0 free flight: orientation is an orthonormal triad rotated incrementally
// in the craft's own body frame (Rodrigues) — no Euler angles, no gimbal lock.
// Also owns the chase camera and the grind-then-crash ground contact.

import { WATER_LEVEL, GRIND_DEPTH, START } from './config.js';
import { craft, craftB, camPos, viewPos, viewZoom, camMode, pilotAim, flags, probe } from './state.js';
import { normalize3, cross3, rotV, clamp1 } from './math.js';
import { keys, touchInput, gyroInput, mouse, mouseView, viewOrigin, IS_TOUCH } from './input.js';
import { terrainShapeJ } from './terrain.js';
import { doCrash, unCrash } from './hud.js';
import { collectTree } from './spores.js';
import { updateRings, initRings } from './rings.js';
import { fireGun, updateBullets, updateBombs, resolveBlasts } from './weapons.js';
import { driftClouds, cloudImmersion } from './clouds.js';
import { updateAliens, initAliens } from './aliens.js';
import { engineUpdate, grindUpdate, cloudWindUpdate } from './audio.js';
import { emitTrail } from './fx.js';
import { TUNED } from './tune.js';

// v4.0 chase camera: its own persistent triad, eased toward the craft's each
// frame — through a loop the camera's horizon rolls over with the plane.
let camR = [-1, 0, 0], camU = [0, 1, 0], camF = [0, 0, 1];
// mouse-orbit state (v7.4): eased angles + their targets
let orbitYaw = 0, orbitPitch = 0, orbitYawT = 0, orbitPitchT = 0;
let followHdg = [0, 0, 1];   // level-flight heading memory (far-zoom loop exception)
let followWCur = 1;          // latched follow weight (1 = chase the nose, 0 = stand off level)
let prevFree = false, prevPilot = false;   // camMode edge detection (Y / X toggles)
let prevObs = false, obsFreeWas = false;   // O = observation/saucer mode (v9.1)
let savedView = null;   // Y-off snapshot: zoom + orbit restored on the next Y-on
let pilotSaved = null;  // X-entry snapshot: the external view's angles, restored on X-exit (v8.5)
// Inverse of the orbit mapping (v8.5): find the virtual origin that makes
// the CURRENT cursor position produce the given angles — so restoring a view
// is exact no matter where the mouse moved meanwhile. The deadzone ramp
// makes it nonlinear; R·ramp(R) is monotonic, so bisection nails it.
function originForAngles(yaw, pitch, mx, my, vw, vh) {
  const bx = -yaw * (vw / 2) / Math.PI;
  const by = pitch * (vh / 2) / (Math.PI / 2);
  const B = Math.hypot(bx, by);
  if (B < 1e-4) return { x: mx, y: my };
  const dead = vh * 0.13 + 20;
  let lo = dead + 0.001, hi = Math.max(B, dead + 60) + 1;
  for (let i = 0; i < 24; i++) {
    const R = (lo + hi) / 2;
    let mm = Math.max(0, Math.min(1, (R - dead) / 60));
    mm = mm * mm * (3 - 2 * mm);
    if (R * mm < B) lo = R; else hi = R;
  }
  const s = (lo + hi) / 2 / B;
  return { x: mx - bx * s, y: my - by * s };
}

// The chase camera's rest pose (13 Sept 2026): where the springs in
// updateFlight would come to rest for a craft heading f - the camera zd back
// and zh up along its own axes, looking at a point la ahead of the craft, the
// whole rig lag further behind. The pose depends on its own up vector, so it
// is solved by iteration (12 rounds: ~1e-6 rad). Used by the instant Y-off
// snap (v8.5) and by the Debug 'obs camera' = snap mode.
function chasePose(f, la, zd, zh, lag) {
  let cF = [f[0], f[1], f[2]];
  let cR = [1, 0, 0], cU = [0, 1, 0];
  for (let i = 0; i < 12; i++) {
    cF = normalize3([f[0] * la + cF[0] * zd - cU[0] * zh,
                     f[1] * la + cF[1] * zd - cU[1] * zh,
                     f[2] * la + cF[2] * zd - cU[2] * zh]);
    cR = cross3(cF, [0, 1, 0]);
    const cl = Math.hypot(cR[0], cR[1], cR[2]) || 1;
    cR = [cR[0] / cl, cR[1] / cl, cR[2] / cl];
    cU = cross3(cR, cF);
  }
  return { f: cF, r: cR, u: cU,
           pos: [craft.pos[0] - cF[0] * zd + cU[0] * zh - f[0] * lag,
                 craft.pos[1] - cF[1] * zd + cU[1] * zh - f[1] * lag,
                 craft.pos[2] - cF[2] * zd + cU[2] * zh - f[2] * lag] };
}

let zoomCur = 1;   // eased wheel zoom (viewZoom.t is the target)

export function resetFlight() {
  craft.pos = [START.x, START.y, START.z];
  craft.r = [-1, 0, 0]; craft.u = [0, 1, 0]; craft.f = [0, 0, 1];
  craft.rollVel = 0; craft.pitchVel = 0;
  craft.speed = 95;
  camR = [-1, 0, 0]; camU = [0, 1, 0]; camF = [0, 0, 1];
  // R also resets the view (v7.7): default zoom, orbit recentered on the cursor
  viewZoom.t = 1; zoomCur = 1;
  camMode.free = false; camMode.pilot = false; camMode.obs = false;
  savedView = null; pilotSaved = null;   // R: view memory back to factory
  initAliens();                          // fresh invasion
  viewOrigin.x = mouseView.x; viewOrigin.y = mouseView.y;
  orbitYaw = 0; orbitPitch = 0; orbitYawT = 0; orbitPitchT = 0;
  unCrash();
  initRings();
  // v9.5 TELEPORT: #pos=x,y,z&hdg=D&obs=1 in the URL overrides the spawn, so
  // a glitch spot can be handed over as a link and R returns to it. Heading
  // uses the HUD's own convention (deg = atan2(f.x, f.z)); the default triad
  // is f = +z, r = -x, so r = (-cos, 0, sin).
  try {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const p = (h.get('pos') || '').split(',').map(Number);
    if (p.length === 3 && p.every(Number.isFinite)) {
      craft.pos = [p[0], p[1], p[2]];
      const hd = Number(h.get('hdg'));
      if (Number.isFinite(hd)) {
        const a = hd * Math.PI / 180;
        craft.f = [Math.sin(a), 0, Math.cos(a)]; craft.r = [-Math.cos(a), 0, Math.sin(a)];
        camF = [craft.f[0], 0, craft.f[2]]; camR = [craft.r[0], 0, craft.r[2]];
      }
      if (h.get('obs') === '1') camMode.obs = true;
    }
  } catch (e) { /* a malformed hash is not worth breaking the reset over */ }
}

let sndBend = 0;   // engine pitch bend in octaves: W/Q held → down, S/E held → up
export let grindAmt = 0;          // 0..1 this frame — drives rumble volume + camera shake
export function update(dt, now) {
  if (flags.crashed) {
    // frozen scene: keep rendering the wreck site, wait for R
    const b = craftB();
    const cf = normalize3([craft.pos[0] - camPos[0], craft.pos[1] - camPos[1], craft.pos[2] - camPos[2]]);
    let cr = cross3(cf, [0, 1, 0]);
    const crl = Math.hypot(cr[0], cr[1], cr[2]);
    cr = crl > 1e-4 ? [cr[0]/crl, cr[1]/crl, cr[2]/crl] : [-1, 0, 0];
    const cu = cross3(cr, cf);
    grindAmt = 0;
    engineUpdate(0, false, 0, 0);
    grindUpdate(0);
    cloudWindUpdate(0);
    viewZoom.cockpit = 0;   // the wreck should be visible
    pilotAim.on = 0;
    viewPos[0] = camPos[0]; viewPos[1] = camPos[1]; viewPos[2] = camPos[2];
    return { craftBasis: b,
             camBasis: { right: cr, up: cu, fwd: cf, mat: new Float32Array([...cr, ...cu, ...cf]) } };
  }
  // sum of all input sources (keyboard + joystick + gyro), clamped
  const steer = clamp1((keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0) + touchInput.steer + gyroInput.steer);   // inverted per pilot preference (v1.2)
  const pitchIn = clamp1((keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0) + touchInput.pitch + gyroInput.pitch); // W nose down, S nose up
  const lift = clamp1((keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0) + touchInput.lift);
  const boost = keys.ShiftLeft || keys.ShiftRight || touchInput.boost;

  const rollFree = !!keys.Space;   // hoisted (v9.1): the camera reads it in every mode
  let b, groundH;
  if (camMode.obs) {
    // ---- OBSERVATION MODE (v9.1): park as a hovering saucer ----
    // Speed bleeds to zero, the craft levels itself, and the ARROW keys
    // translate it like a UFO (up/down arrows = forward/back along the nose,
    // left/right = strafe); W/S move it vertically. Terrain-clamped, no
    // crash — it is a tweaking/observation tool.
    craft.speed += (0 - craft.speed) * Math.min(1, dt * 3);
    craft.rollVel = 0; craft.pitchVel = 0;
    const lvlK = Math.min(1, dt * 2.5);
    craft.f = normalize3([craft.f[0], craft.f[1] * (1 - lvlK), craft.f[2]]);
    craft.u = normalize3([craft.u[0] * (1 - lvlK), craft.u[1] * (1 - lvlK) + lvlK, craft.u[2] * (1 - lvlK)]);
    craft.r = normalize3(cross3(craft.f, craft.u));
    craft.u = cross3(craft.r, craft.f);
    const fl = Math.hypot(craft.f[0], craft.f[2]) || 1;
    const mf = ((keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0)) * 60 * dt;
    const ms = ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * 60 * dt;
    craft.pos[0] += craft.f[0] / fl * mf + craft.r[0] * ms;
    craft.pos[2] += craft.f[2] / fl * mf + craft.r[2] * ms;
    craft.pos[1] += ((keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0)) * 45 * dt;
    groundH = (probe.ground !== null) ? probe.ground : terrainShapeJ(craft.pos[0], craft.pos[2]);
    craft.pos[1] = Math.max(craft.pos[1], Math.max(groundH, WATER_LEVEL) + 3);
    grindAmt = 0;
    b = craftB();
  } else {
  // ---- v4.0 FREE FLIGHT ----
  // A/D roll and W/S pitch are applied as incremental rotations in the
  // craft's OWN body frame (Rodrigues), so orientation is unrestricted:
  // hold S through a full 360° loop, roll inverted, fly knife-edge — the
  // triad never gimbal-locks. Turning = bank (A/D) then pull (S), like a
  // real aircraft. Angular rates are eased for feel.
  const ROLL_RATE = 2.0, PITCH_RATE = 1.15;   // rad/s at full deflection
  // SPACE = full FREE FLIGHT mode (v6.0; was Y — e.code is physical-position
  // based, so on QWERTZ keyboards the key labeled Y reports 'KeyZ'; Space is
  // layout-independent). Space released: jul's arcade — bank sprung toward
  // ~49° max, hands-off auto-level, nose eases back to the horizon (loops
  // via W/S still work: pitch integrates freely while held). Space HELD:
  // the raw v4.6 triad — free roll rate, NO auto-level, NO pitch decay —
  // barrel rolls, knife-edge, sustained inverted flight.
  craft.rollVel  += ((rollFree ? steer * ROLL_RATE : 0) - craft.rollVel) * Math.min(1, dt * 6);
  craft.pitchVel += (pitchIn * PITCH_RATE - craft.pitchVel) * Math.min(1, dt * 6);
  if (Math.abs(craft.rollVel) > 1e-4) {
    const a = -craft.rollVel * dt;            // sign preserves v1.5 bank direction
    craft.r = rotV(craft.r, craft.f, a);
    craft.u = rotV(craft.u, craft.f, a);
  }
  if (Math.abs(craft.pitchVel) > 1e-4) {
    const a = craft.pitchVel * dt;
    craft.f = rotV(craft.f, craft.r, a);
    craft.u = rotV(craft.u, craft.r, a);
  }
  // arcade banked steering (Y released): spring the bank toward steer·0.85
  // rad (~49°, jul's max bank) at jul's 4.0/s ease — press-and-hold turns at
  // a fixed bank, analog joystick deflection gives proportional bank
  if (!rollFree && steer !== 0 && Math.abs(craft.f[1]) < 0.99) {
    const tu = normalize3([-craft.f[0] * craft.f[1], 1 - craft.f[1] * craft.f[1], -craft.f[2] * craft.f[1]]);
    const cx = cross3(craft.u, tu);
    const sinA = cx[0] * craft.f[0] + cx[1] * craft.f[1] + cx[2] * craft.f[2];
    const cosA = craft.u[0] * tu[0] + craft.u[1] * tu[1] + craft.u[2] * tu[2];
    const toLevel = Math.atan2(sinA, cosA);
    const a = (toLevel - steer * 0.85) * Math.min(1, dt * 4.0);
    craft.r = rotV(craft.r, craft.f, a);
    craft.u = rotV(craft.u, craft.f, a);
  }
  // ---- hands-off auto-stabilize (v5.4): jul's arcade feel on the free triad.
  // Jul's model treats roll/pitch as sprung ANGLES (roll eases to a steer
  // target at 4.0/s; released pitch decays 0.5^(0.7·dt)); ours are free RATES
  // so loops and barrel rolls work. The reconciliation: while a key is held
  // the triad rotates freely, and on release jul's exact spring curves take
  // over. Gates keep aerobatics pure: A/D held = no leveling at all; W/S held
  // = no ROLL leveling, so a loop is never flipped at its inverted apex (that
  // was the v5.4 "barrel roll at the top of the loop" bug); pitch decay only
  // engages near-upright — from a steep bank the roll spring rights the plane
  // first and the nose then settles, a natural two-beat recovery.
  if (!rollFree && steer === 0 && pitchIn === 0 && Math.abs(craft.f[1]) < 0.99) {
    // bank spring to level, from ANY bank (even inverted), engaged the moment
    // the keys are released: world up projected ⊥ forward, angle about f
    const tu = normalize3([-craft.f[0] * craft.f[1], 1 - craft.f[1] * craft.f[1], -craft.f[2] * craft.f[1]]);
    const cx = cross3(craft.u, tu);
    const sinA = cx[0] * craft.f[0] + cx[1] * craft.f[1] + cx[2] * craft.f[2];
    const cosA = craft.u[0] * tu[0] + craft.u[1] * tu[1] + craft.u[2] * tu[2];
    const a = Math.atan2(sinA, cosA) * Math.min(1, dt * 4.0);   // jul's return rate
    craft.r = rotV(craft.r, craft.f, a);
    craft.u = rotV(craft.u, craft.f, a);
  }
  if (!rollFree && pitchIn === 0 && craft.u[1] > 0.3) {
    // nose-to-horizon decay, exactly jul's curve: pitch *= 0.5^(0.7·dt)
    const p = Math.asin(Math.max(-1, Math.min(1, craft.f[1])));
    const a = -p * (1 - Math.pow(0.5, dt * 0.7));
    craft.f = rotV(craft.f, craft.r, a);
    craft.u = rotV(craft.u, craft.r, a);
  }
  // coordinated turn (v4.1): a banked wing curves the flight path toward the
  // low wing, restoring v1's bank-to-turn feel inside free flight. The whole
  // triad rotates about the WORLD vertical at a rate proportional to bank
  // (r[1] = sin(bank) when upright; 1.2 matches the old turn rate at ~45°),
  // gated by max(0, u[1]) so it fades to ZERO at knife-edge, inverted, and
  // through loops — aerobatics stay pure, cruising turns fly themselves.
  // v6.0: while actively rolling in free-flight mode (SPACE + A/D) this yaw
  // term would nudge the nose every frame and precess the roll axis — the
  // barrel-roll "wobble". It fades out with roll rate and returns as the
  // roll stops, so banked turning in free mode is untouched.
  const rollSteady = rollFree ? Math.max(0, 1 - Math.abs(craft.rollVel) / 0.6) : 1;
  const turnRate = craft.r[1] * 1.2 * Math.max(0, craft.u[1]) * rollSteady;
  if (Math.abs(turnRate) > 1e-4) {
    const a = turnRate * dt, Y = [0, 1, 0];
    craft.f = rotV(craft.f, Y, a);
    craft.r = rotV(craft.r, Y, a);
    craft.u = rotV(craft.u, Y, a);
  }
  // re-orthonormalize the triad (kills numeric drift; same handedness as v1)
  craft.f = normalize3(craft.f);
  craft.r = normalize3(cross3(craft.f, craft.u));
  craft.u = cross3(craft.r, craft.f);

  // speed: throttle target plus a light energy exchange — dives gain speed,
  // climbs bleed it, so the top of a loop feels appropriately slow
  const targetSpeed = boost ? 280 : 95;
  craft.speed += (targetSpeed - craft.speed) * Math.min(1, dt * 2.0);
  craft.speed = Math.max(60, Math.min(330, craft.speed - craft.f[1] * 45 * dt));

  b = craftB();
  craft.pos[0] += b.fwd[0] * craft.speed * dt;
  craft.pos[1] += b.fwd[1] * craft.speed * dt + lift * 110 * dt;
  craft.pos[2] += b.fwd[2] * craft.speed * dt;

  // ---- collision = end of flight ----
  // GPU probe value = exactly the terrain the pixels show (fp32), refreshed
  // every frame. Fp64 JS mirror only bridges the first frame before readback.
  groundH = (probe.ground !== null) ? probe.ground : terrainShapeJ(craft.pos[0], craft.pos[2]);
  // Two-stage terrain contact (v3.1): touching the surface only GRINDS —
  // rumble, camera shake, speed bleed — the fatal crash sits GRIND_DEPTH
  // below the old contact level. A shallow, near-horizontal descent scrapes
  // along the ground with time to pull up; a steep dive punches through the
  // whole band within a frame or two and still crashes essentially on impact.
  const grindTop   = groundH + 1.3;             // old crash level = first contact
  const crashLevel = grindTop - GRIND_DEPTH;    // the real collision, under the surface
  grindAmt = 0;
  if (craft.pos[1] < crashLevel) {
    craft.pos[1] = crashLevel;
    doCrash('TERRAIN IMPACT');
  } else if (craft.pos[1] < WATER_LEVEL + 1.0) {
    craft.pos[1] = WATER_LEVEL + 1.0;
    doCrash('SPLASHDOWN');
  } else {
    if (craft.pos[1] < grindTop) {
      grindAmt = Math.min(1, (grindTop - craft.pos[1]) / GRIND_DEPTH);
      craft.speed -= craft.speed * grindAmt * dt * 0.55;   // ground friction bleeds speed
    }
    if (probe.plantD < 2.2) collectTree();   // trees are spores to harvest, not walls (v1.7)
  }
  }   // end normal-flight branch (observation mode skips the physics)

  updateRings(craft.pos, b.fwd, dt);   // ring course: pass-through scoring + respawn

  updateBullets(dt);   // tracers fly (and hit) independently of the craft
  updateBombs(dt);     // bombs fall straight down, detonate on the GPU's ground
  resolveBlasts();     // settle last frame's blast probe, arm the next
  updateAliens(dt, now);   // the invasion economy ticks (v9.0)
  // clouds drift with the wind; wind noise swells when flying through one
  driftClouds(dt);
  cloudWindUpdate(cloudImmersion());
  // hold-to-burst: left button held keeps firing (~8.7/s), throttled by the
  // 8-slot magazine — a full burst, a beat while tracers land, another burst.
  if (mouse.lmbDown && now - mouse.lastAuto >= 115) { fireGun(); mouse.lastAuto = now; }

  // engine + contrails
  const boosting = !!boost;
  // W (dive) and Q (altitude down) bend the engine pitch down for as long as
  // held; S and E bend it up; released, it relaxes back over ~a second.
  const bendIn = ((keys.KeyS ? 1 : 0) + (keys.KeyE ? 1 : 0)) - ((keys.KeyW ? 1 : 0) + (keys.KeyQ ? 1 : 0));
  if (bendIn < 0)      sndBend = Math.max(-1.3, sndBend - dt * 0.85);
  else if (bendIn > 0) sndBend = Math.min( 1.3, sndBend + dt * 0.85);
  else                 sndBend *= Math.pow(0.5, dt / 0.7);
  const turn = Math.min(1, Math.max(0, 1 - craft.u[1]));   // 0 upright → 1 knife-edge/inverted
  engineUpdate(craft.speed, boosting, sndBend, turn);
  grindUpdate(grindAmt);
  if (!flags.crashed && craft.speed > 70) emitTrail(b, now, boosting);

  // chase cam v4.0: the camera keeps its own triad and eases it toward the
  // craft's — through a loop the horizon rolls over with you; inverted
  // flight looks inverted. Position hangs behind/above along the CAMERA's
  // axes so it swings smoothly instead of snapping with the plane.
  // wheel zoom (v7.4): eased here because the whole chase geometry scales
  // with it. The look-ahead anchor MUST scale too: with a fixed 30 m anchor
  // the camera-pitch equilibrium (30·(f·camU) ≈ 5.5·zoom) stops existing
  // beyond zoom ≈ 5.5, and with no fixed point the pitch integrates forever —
  // the far-zoom "whole world starts orbiting the plane" bug. Scaling the
  // anchor keeps the zoom-1 geometry, and its equilibrium, at any distance.
  zoomCur += (viewZoom.t - zoomCur) * Math.min(1, dt * 5);
  const zA = 30 * Math.max(1, zoomCur);
  // far-zoom loop exception (v7.8): when the camera arm is longer than the
  // plane's height above the terrain, following the nose through a loop
  // would drag the camera into the ground. The camera keeps a MEMORY of the
  // level-flight heading — refreshed only while flying roughly level and
  // upright, so aerobatics can't corrupt it — and past that arm/altitude
  // ratio it follows the memory instead: it stands off, stays level, and
  // watches the loop from outside. Smoothly blended; no effect at close
  // zoom or high altitude.
  if (Math.abs(craft.f[1]) < 0.7 && craft.u[1] > 0.2) {
    const hm = Math.hypot(craft.f[0], craft.f[2]) || 1;
    const kh = Math.min(1, dt * 4);
    followHdg[0] += (craft.f[0] / hm - followHdg[0]) * kh;
    followHdg[2] += (craft.f[2] / hm - followHdg[2]) * kh;
    const hl = Math.hypot(followHdg[0], followHdg[2]) || 1;
    followHdg[0] /= hl; followHdg[2] /= hl;
  }
  const camAlt = craft.pos[1] - Math.max(groundH, WATER_LEVEL);
  const targetW = 1 - Math.min(1, Math.max(0, (17.8 * zoomCur / Math.max(camAlt, 1) - 0.9) / 0.4));
  // LATCHED: standing off engages at any moment, but the follow only
  // RE-engages during level upright flight — otherwise the altitude gained
  // mid-loop would flip the camera back into chasing the maneuver halfway
  if (targetW < followWCur) followWCur += (targetW - followWCur) * Math.min(1, dt * 3);
  else if (Math.abs(craft.f[1]) < 0.35 && craft.u[1] > 0.5) followWCur += (targetW - followWCur) * Math.min(1, dt * 1.5);
  const followW = followWCur;
  let eF = [b.fwd[0] * followW + followHdg[0] * (1 - followW),
            b.fwd[1] * followW,
            b.fwd[2] * followW + followHdg[2] * (1 - followW)];
  const eFl = Math.hypot(eF[0], eF[1], eF[2]);
  eF = eFl > 1e-3 ? [eF[0] / eFl, eF[1] / eFl, eF[2] / eFl] : [followHdg[0], 0, followHdg[2]];
  const lookAt = [
    craft.pos[0] + eF[0] * zA,
    craft.pos[1] + eF[1] * zA,
    craft.pos[2] + eF[2] * zA
  ];
  const zd = 17 * zoomCur;
  // far-zoom framing (v7.7): the craft's screen height is set purely by the
  // camera arm's height/distance ratio — the rig rotates rigidly about its
  // equilibrium, so aiming tricks don't move it. Blending the ratio from the
  // classic 5.5/17 down to 4.0/17 as you zoom out parks the plane at ~1/3
  // from the bottom instead of 1/4. The default view is untouched.
  const zh = (5.5 - 1.5 * Math.min(1, Math.max(0, (zoomCur - 1) / 9))) * zoomCur;
  // Debug 'obs camera' (13 Sept 2026, observation mode only). The springs
  // below take ~3 s to settle after an arrow tap (0.34 deg of pitch still to
  // go at 1.5 s, measured live), so a screenshot taken sooner is of a camera
  // that is still moving. 'snap' parks the camera at the springs' own rest
  // pose every frame; 'freeze' leaves it where it is while the craft moves
  // off. Both tell a settling camera from a changing world.
  const obsCam = camMode.obs ? TUNED.obsCam.v : 0;
  if (obsCam < 0.5) {
  // close zooms stiffen the springs: the chase lag (~27 m at cruise) would
  // otherwise keep the camera away no matter how far you scroll in — the
  // plane now fills the screen before the view drops into the cockpit
  const zStiff = Math.min(1, zoomCur);
  const kv = Math.min(1, dt * 4.2 / zStiff);
  const tF = normalize3([lookAt[0] - camPos[0], lookAt[1] - camPos[1], lookAt[2] - camPos[2]]);
  camF = normalize3([camF[0] + (tF[0] - camF[0]) * kv,
                     camF[1] + (tF[1] - camF[1]) * kv,
                     camF[2] + (tF[2] - camF[2]) * kv]);
  // camera roll-follow (v5.4): jul's camera rolls only 30% with the plane,
  // keeping the horizon ~level in arcade turns — that is what makes the 49°
  // bank READ on screen (a fully rolling camera makes the same bank look
  // flat). Follow the craft's up ~35% when cruising/turning, ramping to 100%
  // for real aerobatics (steep bank, big pitch, or SPACE held) so loops,
  // barrel rolls and inverted flight still roll the horizon with you.
  const bankAmt = 1 - Math.max(0, craft.u[1]);
  const aero = rollFree ? 1 : Math.max(
    Math.min(1, Math.max(0, (bankAmt - 0.35) / 0.35)),
    Math.min(1, Math.max(0, (Math.abs(craft.f[1]) - 0.45) / 0.3)));
  const wF = 0.35 + 0.65 * aero;
  const clu = normalize3([-craft.f[0] * craft.f[1], 1 - craft.f[1] * craft.f[1], -craft.f[2] * craft.f[1]]);
  const cuT = [clu[0] * (1 - wF) + craft.u[0] * wF,
               clu[1] * (1 - wF) + craft.u[1] * wF,
               clu[2] * (1 - wF) + craft.u[2] * wF];
  // loop exception: a stood-off camera keeps a level horizon
  cuT[0] *= followW; cuT[1] = cuT[1] * followW + (1 - followW); cuT[2] *= followW;
  const uT = [camU[0] + (cuT[0] - camU[0]) * kv,
              camU[1] + (cuT[1] - camU[1]) * kv,
              camU[2] + (cuT[2] - camU[2]) * kv];
  let nR = cross3(camF, uT);
  const nRl = Math.hypot(nR[0], nR[1], nR[2]);
  if (nRl > 1e-4) {          // degenerate only if looking straight along up
    camR = [nR[0]/nRl, nR[1]/nRl, nR[2]/nRl];
    camU = cross3(camR, camF);
  }
  const desired = [
    craft.pos[0] - camF[0] * zd + camU[0] * zh,
    craft.pos[1] - camF[1] * zd + camU[1] * zh,
    craft.pos[2] - camF[2] * zd + camU[2] * zh
  ];
  const k = Math.min(1, dt * 3.5 / zStiff);
  camPos[0] += (desired[0] - camPos[0]) * k;
  camPos[1] += (desired[1] - camPos[1]) * k;
  camPos[2] += (desired[2] - camPos[2]) * k;
  } else if (obsCam < 1.5) {
    // snap: the pose the springs above would settle into, every frame
    const pose = chasePose(eF, zA, zd, zh, 0);
    camF = pose.f; camR = pose.r; camU = pose.u;
    camPos[0] = pose.pos[0]; camPos[1] = pose.pos[1]; camPos[2] = pose.pos[2];
  }   // else freeze: the camera stays exactly where it is while the craft moves

  // ---- mouse-orbit view (v7.4) ----
  // The mouse position orbits the RENDER camera around the plane: full screen
  // width = 360° of yaw (mouse right = see the plane's LEFT side), vertical =
  // ±90° (top edge = top-down). A dead circle around the plane (its screen
  // footprint + 20 px) keeps the classic chase view; angles ease so the view
  // swings instead of snapping. The chase camera itself is untouched — the
  // orbit only rotates what is rendered, and BOTH pipelines (GPU + 2D
  // overlay) consume the same rotated view, so nothing can misalign.
  // Y / X camera modes (v8.1): input.js just flips the flags; transitions
  // are handled here. Y ON engages mouse-cam + wheel without a jump (orbit
  // center rebased onto the cursor); Y OFF resets to the plain chase view.
  // X drops into the pilot seat with the gaze reset to straight ahead.
  // O transitions: entering observation force-enables the free camera (Y);
  // leaving restores whatever Y state you had before
  if (camMode.obs && !prevObs) { obsFreeWas = camMode.free; camMode.free = true; }
  if (!camMode.obs && prevObs) { camMode.free = obsFreeWas; }
  prevObs = camMode.obs;
  if (camMode.free && !prevFree) {
    if (savedView) {
      // Y remembers: pop instantly back to the exact previous view — same
      // zoom, same orbit origin/angles, and the chase camera itself snapped
      // to its saved craft-relative position and orientation (identical
      // framing if the mouse has not moved; otherwise it glides from there)
      viewZoom.t = savedView.t; zoomCur = savedView.t;
      // angle restore is cursor-independent: rebase the origin so the mouse's
      // CURRENT position reproduces the saved angles exactly
      const o = originForAngles(savedView.yaw, savedView.pitch, mouseView.x, mouseView.y, window.innerWidth, window.innerHeight);
      viewOrigin.x = o.x; viewOrigin.y = o.y;
      orbitYaw = savedView.yaw; orbitPitch = savedView.pitch;
      orbitYawT = savedView.yaw; orbitPitchT = savedView.pitch;
      camPos[0] = craft.pos[0] + savedView.cp[0];
      camPos[1] = craft.pos[1] + savedView.cp[1];
      camPos[2] = craft.pos[2] + savedView.cp[2];
      camR = [...savedView.cr]; camU = [...savedView.cu]; camF = [...savedView.cf];
    } else {
      viewOrigin.x = mouseView.x; viewOrigin.y = mouseView.y;
    }
  }
  if (!camMode.free && prevFree) {
    // if Y goes off while in the pilot seat, remember the OUTSIDE view's
    // angles (pre-X snapshot), not the pilot's gaze direction
    const extYaw = (camMode.pilot && pilotSaved) ? pilotSaved.yaw : orbitYaw;
    const extPitch = (camMode.pilot && pilotSaved) ? pilotSaved.pitch : orbitPitch;
    savedView = { t: viewZoom.t, ox: viewOrigin.x, oy: viewOrigin.y, yaw: extYaw, pitch: extPitch,
                  cp: [camPos[0] - craft.pos[0], camPos[1] - craft.pos[1], camPos[2] - craft.pos[2]],
                  cr: [...camR], cu: [...camU], cf: [...camF] };
    viewZoom.t = 1; camMode.pilot = false; pilotSaved = null;
    // instant OFF (v8.5): no glide — snap zoom, orbit and the chase camera
    // itself straight to the steady behind-the-plane pose. The pose solves
    // the camera's own fixed point (look-ahead + arm + spring lag at the
    // current speed), so the next frames don't visibly settle either.
    zoomCur = 1;
    orbitYaw = 0; orbitPitch = 0; orbitYawT = 0; orbitPitchT = 0;
    const lag = craft.speed / 3.5;   // spring-lag term at the current speed
    const pose = chasePose(craft.f, 30 + lag, 17, 5.5, lag);
    camF = pose.f; camR = pose.r; camU = pose.u;
    camPos[0] = pose.pos[0]; camPos[1] = pose.pos[1]; camPos[2] = pose.pos[2];
  }
  if (camMode.pilot && !prevPilot) {
    pilotSaved = { yaw: orbitYaw, pitch: orbitPitch };   // remember the outside view
    orbitYaw = 0; orbitPitch = 0; orbitYawT = 0; orbitPitchT = 0;
    viewOrigin.x = mouseView.x; viewOrigin.y = mouseView.y;
  }
  if (!camMode.pilot && prevPilot && pilotSaved) {
    // X-exit: back to the exact outside view (Y active: the zoomed, angled
    // view; Y off: angles were 0, so the plain chase view) — origin rebased
    // so the current cursor reproduces the saved angles
    const o = originForAngles(pilotSaved.yaw, pilotSaved.pitch, mouseView.x, mouseView.y, window.innerWidth, window.innerHeight);
    viewOrigin.x = o.x; viewOrigin.y = o.y;
    orbitYaw = pilotSaved.yaw; orbitPitch = pilotSaved.pitch;
    orbitYawT = pilotSaved.yaw; orbitPitchT = pilotSaved.pitch;
    pilotSaved = null;
  }
  prevFree = camMode.free; prevPilot = camMode.pilot;
  if (!IS_TOUCH && (camMode.free || camMode.pilot)) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const mdx = mouseView.x - viewOrigin.x, mdy = mouseView.y - viewOrigin.y;   // v7.4: middle-click rebases the center
    const mr = Math.hypot(mdx, mdy);
    const dead = vh * 0.13 + 20;              // ~the plane's screen size + 20 px
    let mm = (mr - dead) / 60;                // smooth onset past the circle
    mm = Math.max(0, Math.min(1, mm));
    mm = mm * mm * (3 - 2 * mm);
    orbitYawT   = -(mdx / (vw / 2)) * Math.PI * mm;         // edge = 180°
    orbitPitchT =  (mdy / (vh / 2)) * (Math.PI / 2) * mm;   // edge = 90°
  } else {
    orbitYawT = 0; orbitPitchT = 0;   // camera modes off: mouse does nothing
  }
  orbitYaw   += (orbitYawT   - orbitYaw)   * Math.min(1, dt * 6);
  orbitPitch += (orbitPitchT - orbitPitch) * Math.min(1, dt * 6);

  // ---- cockpit / pilot view (v7.4) ----
  // Zoomed all the way in: the camera sits at the canopy, the plane is not
  // rendered (uCockpit hides it in the shader), and the mouse angles become
  // the pilot's HEAD: mouse right = look right, top edge = look straight up.
  // The craft's own basis carries the view, so banking rolls the horizon.
  pilotAim.on = 0;
  viewZoom.cockpit = (camMode.pilot || zoomCur < 0.13) ? 1 : 0;
  if (viewZoom.cockpit) {
    const lyaw = orbitYaw, lpit = -orbitPitch;
    let pF = craft.f, pR = craft.r, pU = craft.u;
    if (Math.abs(lyaw) > 1e-3) { pF = rotV(pF, craft.u, lyaw); pR = rotV(pR, craft.u, lyaw); }
    if (Math.abs(lpit) > 1e-3) { pU = rotV(craft.u, pR, lpit); pF = rotV(pF, pR, lpit); }
    // guns & bombs follow the pilot's gaze (v7.4): weapons read pilotAim
    pilotAim.on = 1;
    pilotAim.fwd[0] = pF[0]; pilotAim.fwd[1] = pF[1]; pilotAim.fwd[2] = pF[2];
    pilotAim.right[0] = pR[0]; pilotAim.right[1] = pR[1]; pilotAim.right[2] = pR[2];
    pilotAim.up[0] = pU[0]; pilotAim.up[1] = pU[1]; pilotAim.up[2] = pU[2];
    viewPos[0] = craft.pos[0] + craft.f[0] * 0.8 + craft.u[0] * 0.35;
    viewPos[1] = craft.pos[1] + craft.f[1] * 0.8 + craft.u[1] * 0.35;
    viewPos[2] = craft.pos[2] + craft.f[2] * 0.8 + craft.u[2] * 0.35;
    return { craftBasis: b,
             camBasis: { right: pR, up: pU, fwd: pF, mat: new Float32Array([...pR, ...pU, ...pF]) } };
  }

  let vR = camR, vU = camU, vF = camF;
  viewPos[0] = camPos[0]; viewPos[1] = camPos[1]; viewPos[2] = camPos[2];
  if (Math.abs(orbitYaw) > 1e-3 || Math.abs(orbitPitch) > 1e-3) {
    const c = craft.pos;
    let off = [camPos[0] - c[0], camPos[1] - c[1], camPos[2] - c[2]];
    off = rotV(off, camU, orbitYaw);          // yaw about the camera's up
    vF = rotV(camF, camU, orbitYaw);
    vR = rotV(camR, camU, orbitYaw);
    off = rotV(off, vR, orbitPitch);          // then pitch about the yawed right
    vF = rotV(vF, vR, orbitPitch);
    vU = rotV(camU, vR, orbitPitch);
    viewPos[0] = c[0] + off[0]; viewPos[1] = c[1] + off[1]; viewPos[2] = c[2] + off[2];
  }

  // camera-terrain collision (v7.7): the view camera never sinks into the
  // ground or the sea — clamped to terrain/water + 3 m, and while clamped it
  // re-aims at the plane so you skim the ridge instead of staring into rock.
  const camGround = Math.max(terrainShapeJ(viewPos[0], viewPos[2]), WATER_LEVEL) + 3.0;
  if (viewPos[1] < camGround) {
    viewPos[1] = camGround;
    const cf = normalize3([craft.pos[0] - viewPos[0], craft.pos[1] - viewPos[1], craft.pos[2] - viewPos[2]]);
    let cr = cross3(cf, [0, 1, 0]);
    const crl = Math.hypot(cr[0], cr[1], cr[2]);
    if (crl > 1e-4) {
      cr = [cr[0] / crl, cr[1] / crl, cr[2] / crl];
      vR = cr; vU = cross3(cr, cf); vF = cf;
    }
  }
  return { craftBasis: b,
           camBasis: { right: vR, up: vU, fwd: vF, mat: new Float32Array([...vR, ...vU, ...vF]) } };
}
