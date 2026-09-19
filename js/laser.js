// ============ PLAYER LASER (v9.9) ============
// Hold the RIGHT button: after LASER_CHARGE_MS the shot is armed (rising hum,
// target cursor). Release and a beam fires from the plane to whatever the
// CURSOR was pointing at in the 3D world. A hull takes LASER_DAMAGE (six bomb
// hits — enough to melt the relay outright); open ground burns a harvest
// circle three times a bomb's radius. Every shot costs LASER_COST energy.
//
// ⚠️ The aim ray is traced in JS, NOT through the GPU probe row, and that is a
// deliberate trade. The probe row is the COLLISION AUTHORITY and is already
// 15.1% of the inlined program (docs/COMPILE.md); adding a full marchTerrain +
// marchAliens there to shade one more pixel would cost seconds of driver
// compile for a reticle. Aiming is not collision — being a metre off picks the
// same target — so this uses the fp64 terrain mirror and analytic hull tests
// and costs the shader nothing.

import { TAN_HALF_FOV, WATER_LEVEL, BLAST_R } from './config.js';
import { laser, craft, viewPos } from './state.js';
import { TUNEA } from './tune.js';
import { terrainShapeJ } from './terrain.js';
import { alien, alienLaserHit } from './aliens.js';
import { harvestCircle } from './weapons.js';
import { laserChargeStop, laserFireSound, laserCrackSound } from './audio.js';
import { LASER_COST, spendEnergy, canFireLaser } from './energy.js';

export const LASER_CHARGE_MS = 2000;
export const LASER_BURN_R = BLAST_R * 3;   // the burn is 3x a bomb's circle
// The muzzle sits on the nose, not at the craft origin. sdCraft's fuselage is
// an ellipsoid with a 2.30 half-length, so this is just off the tip.
const MUZZLE_Z = 2.4;
const T_MAX = 9000;                        // give up past this: it is sky

let camRef = null;                         // latest camera basis, for the release

// ---- ray vs the alien fleet (analytic, same shapes marchAliens uses) -------
function slab(ox, oy, oz, dx, dy, dz, hx, hy, hz) {
  // returns entry distance, or -1: an axis-aligned box centred at the origin
  let tn = -1e18, tf = 1e18;
  const o = [ox, oy, oz], d = [dx, dy, dz], h = [hx, hy, hz];
  for (let i = 0; i < 3; i++) {
    const inv = 1 / (d[i] || 1e-9);
    let a = (-h[i] - o[i]) * inv, b = (h[i] - o[i]) * inv;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > tn) tn = a;
    if (b < tf) tf = b;
  }
  if (tn > tf || tf < 0) return -1;
  return Math.max(tn, 0);
}

// Nearest live hull along the ray. Returns { t, id } or null; ids match the
// shader's mal.y — 0 mothership, 1..6 harvesters, 7 relay.
function traceFleet(ro, rd) {
  let bt = 1e18, bid = -1;
  const m = alien.mother;
  if (!m.gone && !m.falling && m.melt <= 0) {
    const t = slab(ro[0] - m.x, ro[1] - m.y, ro[2] - m.z, rd[0], rd[1], rd[2],
                   TUNEA.moWid.v / 2, TUNEA.moHei.v / 2, TUNEA.moLen.v / 2);
    if (t >= 0 && t < bt) { bt = t; bid = 0; }
  }
  const r = alien.relay;
  if (!r.gone && !r.falling && r.melt <= 0) {
    const ox = ro[0] - r.x, oy = ro[1] - r.y, oz = ro[2] - r.z;
    const b = ox * rd[0] + oy * rd[1] + oz * rd[2];
    const c = ox * ox + oy * oy + oz * oz - r.r * r.r;
    const disc = b * b - c;
    if (disc > 0) {
      const t = -b - Math.sqrt(disc);
      if (t >= 0 && t < bt) { bt = t; bid = 7; }
    }
  }
  for (let i = 0; i < alien.ships.length; i++) {
    const s = alien.ships[i];
    if (s.falling || s.melt > 0) continue;
    // into the hull's yawed frame — the same rotation shipLocal applies
    const ca = Math.cos(s.a), sa = Math.sin(s.a);
    const ox = ro[0] - s.x, oz = ro[2] - s.z;
    const t = slab(ox * ca - oz * sa, ro[1] - s.y, ox * sa + oz * ca,
                   rd[0] * ca - rd[2] * sa, rd[1], rd[0] * sa + rd[2] * ca,
                   TUNEA.shLen.v / 2, TUNEA.shHei.v / 2, TUNEA.shWid.v / 2);
    if (t >= 0 && t < bt) { bt = t; bid = i + 1; }
  }
  return bid < 0 ? null : { t: bt, id: bid };
}

// ---- ray vs the ground ----------------------------------------------------
// A sphere-trace on the fp64 mirror, relaxed the same way the shader's march
// is. It only has to be close enough to pick a spot to burn.
function traceGround(ro, rd) {
  let t = 2;
  for (let i = 0; i < 400 && t < T_MAX; i++) {
    const px = ro[0] + rd[0] * t, py = ro[1] + rd[1] * t, pz = ro[2] + rd[2] * t;
    const h = terrainShapeJ(px, pz);
    const gap = py - Math.max(h, WATER_LEVEL);
    if (gap < 0.6) return t;
    t += Math.max(gap * 0.4, 1.5 + t * 0.0015);
  }
  return -1;
}

// Screen pixel -> world ray. The vertical flip is the trap: clientY runs DOWN
// from the top while the shader's gl_FragCoord.y runs UP from the bottom, so
// an unflipped cursor aims at its own mirror image across the horizon.
function aimRay(cam, cx, cy) {
  const W = window.innerWidth, H = window.innerHeight;
  const ux = ((2 * cx - W) / H) * TAN_HALF_FOV;
  const uy = ((H - 2 * cy) / H) * TAN_HALF_FOV;
  const d = [cam.right[0] * ux + cam.up[0] * uy + cam.fwd[0],
             cam.right[1] * ux + cam.up[1] * uy + cam.fwd[1],
             cam.right[2] * ux + cam.up[2] * uy + cam.fwd[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}

// ---- the button -----------------------------------------------------------
// `armable` is decided HERE, at the press, because that is what the charge
// sound has to commit to: the spin-up tells you up front whether this one is
// going to fire. `matured` records that the hold ran long enough regardless,
// so a dud press is still a laser attempt and never falls through to a bomb.
export function laserPress(now) {
  laser.holding = true;
  laser.holdT0 = now;
  laser.charged = false;
  laser.matured = false;
  laser.armable = canFireLaser();
  return laser.armable;
}

// Called every frame: arms the shot once the hold passes the charge time, and
// ages the drawn beam. The charge is checked here rather than on a timer so it
// cannot fire while the tab is backgrounded and rAF is paused.
export function updateLaser(now, cam) {
  if (cam) camRef = cam;
  if (laser.holding && !laser.matured && now - laser.holdT0 >= LASER_CHARGE_MS) {
    laser.matured = true;
    // the reticle appears only for a shot that can be taken; a dud charge
    // stays a plain crosshair, so the cursor never promises a shot it owes
    if (laser.armable) {
      laser.charged = true;
      document.body.classList.add('laser-armed');
    }
  }
  if (laser.shot && now - laser.shot.t0 > 420) laser.shot = null;
}

// Returns true if a shot was fired. input.js drops a bomb when it returns
// false, so a quick right-click keeps doing exactly what it always did.
export function laserRelease(now, cx, cy) {
  const wasCharged = laser.charged, wasLong = laser.matured;
  laser.holding = false;
  laser.charged = false;
  laser.matured = false;
  laserChargeStop();
  document.body.classList.remove('laser-armed');
  // A long hold is a laser attempt whatever came of it -- returning false here
  // would drop a BOMB at the end of a two-second charge.
  if (!wasCharged || !camRef) return wasLong;
  // Energy can drain between the press and the release (an alien sweep cannot
  // take it, but a second shot can), so re-check rather than trusting the arm.
  if (!canFireLaser() || !spendEnergy(LASER_COST)) return true;

  // TRACE from the camera along the cursor ray -- what is under the cursor is
  // what gets hit, which is only true if the ray starts at the eye. DRAWING
  // starts at the muzzle instead (below), so the beam leaves the nose while
  // still landing exactly where the reticle was.
  const ro = [viewPos[0], viewPos[1], viewPos[2]];
  const rd = aimRay(camRef, cx, cy);
  const hull = traceFleet(ro, rd);
  const tg = traceGround(ro, rd);
  // nearest wins; a hull in front of the ground is the target
  let t = T_MAX, kind = 'sky';
  if (tg >= 0) { t = tg; kind = 'ground'; }
  if (hull && hull.t < t) { t = hull.t; kind = 'hull'; }

  const hit = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
  const muzzle = [craft.pos[0] + craft.f[0] * MUZZLE_Z,
                  craft.pos[1] + craft.f[1] * MUZZLE_Z,
                  craft.pos[2] + craft.f[2] * MUZZLE_Z];
  laser.shot = { a: muzzle, b: hit, t0: now };
  laserFireSound();

  if (kind === 'hull') {
    if (alienLaserHit(hull.id, hit[0], hit[1], hit[2])) laserCrackSound();
  } else if (kind === 'ground') {
    const gh = terrainShapeJ(hit[0], hit[2]);
    harvestCircle(hit[0], Math.max(gh, WATER_LEVEL) + 1.5, hit[2], LASER_BURN_R, gh < WATER_LEVEL);
  }
  return true;
}

export function laserCancel() {
  laser.holding = false;
  laser.charged = false;
  laser.matured = false;
  laser.shot = null;
  laserChargeStop();
  document.body.classList.remove('laser-armed');
}
