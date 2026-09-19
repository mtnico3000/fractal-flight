import { TUNEA } from './tune.js';
import { DBG } from './dbg.js';
import { craft } from './state.js';
import { terrainShapeJ } from './terrain.js';
import { collectedSet } from './spores.js';
import { HULL_BLAST_R } from './config.js';
import { bombs, impacts, blastQueue } from './weapons.js';
import { hullExplosionSound, zapSound, relayBlastSound } from './audio.js';
import { doCrash, setFleetCounts, resetFleetCounts } from './hud.js';
import { addEnergy } from './energy.js';

// ============ ALIEN INVASION (v9.0) ============
// A rectangular-mandelbox MOTHERSHIP parks high over the island. Harvester
// ships (box-cropped mandelboxes) sweep the plains with a cyan-blue laser
// sheet, absorbing spore trees; every few trees they fire an energy bolt to
// the mandelbulb RELAYSHIP on its mountaintop, which grows — at double size
// it discharges a blast up to the mothership, which builds one more
// harvester. Bombs are the counterplay. Downed ships fall and melt into the
// terrain.
const SHIP_MAX = 6;
// Bomb counts to down each hull. alienBombHits() does a plain hp-- and consumes
// the bomb, with no splash — so these ARE the number of direct hits required.
// Named because each value was written twice (spawn site + initAliens reset)
// and the two copies drift apart the moment one is edited alone.
const HP_MOTHER = 40;   // was 10000, i.e. effectively unkillable
const HP_SHIP   = 20;   // was 100, set when hulls were 200 m long rather than 780
const HP_RELAY  = 6;    // smallest target: a 30 m sphere on a peak
export const alien = {
  mother: { x: 400, y: 10000, z: 1800, hp: HP_MOTHER, melt: 0, falling: false, vy: 0, gone: false },
  relay: { x: 0, y: 0, z: 0, ground: 0, r: 15, baseR: 15, hp: HP_RELAY, melt: 0, falling: false, vy: 0, gone: false },
  ships: [],
  bolts: [],
};

// How far a harvester tries to stay from the others. They are 1200 m long, so
// anything under about a length still reads as a pile.
const SHIP_SEP = 1800;

function nearestShipDist(x, z, self) {
  let d = 1e9;
  for (const o of alien.ships) {
    if (o === self || o.falling || o.melt > 0) continue;
    // against the TARGET as well as the position: two ships converging on one
    // plain are already clustered even while they are still far apart
    d = Math.min(d, Math.hypot(o.x - x, o.z - z), Math.hypot((o.tx || o.x) - x, (o.tz || o.z) - z));
  }
  return d;
}

function alienPlainsSpot(cx, cz, radius, self) {
  // A low, harvestable spot (terrain 8..60 m) that is also AWAY FROM THE
  // OTHERS. The old version returned the first candidate inside the height
  // band and considered nothing else, so every harvester walked onto the same
  // plain and sat overlapping. Now all 40 candidates are scored and the best
  // wins, with separation weighted above a perfect plain -- they still share
  // ground sometimes, which is fine, but they no longer pile up.
  let best = null, bestScore = -1e9;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * 6.2832, d = 300 + Math.random() * radius;
    const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
    const h = terrainShapeJ(x, z);
    const fit = 1 - Math.min(1, Math.abs(h - 34) / 26);          // 1 mid-band, 0 at the edges
    const sep = Math.min(nearestShipDist(x, z, self), SHIP_SEP) / SHIP_SEP;
    const score = fit + sep * 1.6;
    if (score > bestScore) { bestScore = score; best = { x, z, h }; }
  }
  return best;
}

function spawnHarvester(fromMother) {
  if (alien.ships.length >= SHIP_MAX) return;
  const spot = alienPlainsSpot(0, 0, 2800);
  const s = {
    x: fromMother ? alien.mother.x : spot.x,
    y: fromMother ? alien.mother.y - 100 : terrainShapeJ(spot.x, spot.z) + 60,
    z: fromMother ? alien.mother.z : spot.z,
    a: Math.random() * 6.2832,          // heading (movement dir; long axis is perpendicular)
    tx: spot.x, tz: spot.z,             // current plains target
    hp: HP_SHIP, melt: 0, falling: false, vy: 0,
    deploying: !!fromMother,
    absorbed: 0, loot: 0, lastShot: 0, sweepAcc: 0, retarget: 0,
  };
  alien.ships.push(s);
}

export function initAliens() {
  alien.mother.x = 400; alien.mother.z = 1800;
  alien.mother.y = TUNEA.moAlt.v;
  alien.mother.hp = HP_MOTHER; alien.mother.melt = 0; alien.mother.falling = false; alien.mother.vy = 0; alien.mother.gone = false; alien.mother.loot = 0;
  // relay: the highest mountaintop we can find near the island center
  let peak = { x: 0, z: 0, h: -999 };
  for (let i = 0; i < 500; i++) {
    const a = Math.random() * 6.2832, d = Math.random() * 3500;
    const x = Math.sin(a) * d, z = Math.cos(a) * d;
    const h = terrainShapeJ(x, z);
    if (h > peak.h) peak = { x, z, h };
  }
  alien.relay.x = peak.x; alien.relay.z = peak.z; alien.relay.ground = peak.h;
  alien.relay.baseR = TUNEA.relSize.v / 2;
  alien.relay.r = alien.relay.baseR;
  alien.relay.y = peak.h + 30 + alien.relay.r;
  alien.relay.hp = HP_RELAY; alien.relay.melt = 0; alien.relay.falling = false; alien.relay.vy = 0; alien.relay.gone = false; alien.relay.loot = 0;
  alien.relay.shrinkT0 = undefined; alien.relay.shrinkFrom = 0; alien.relay.shots = 0;
  resetFleetCounts();
  alien.ships.length = 0;
  alien.bolts.length = 0;
  spawnHarvester(false); spawnHarvester(false);
}

// A bomb landing on a hull flags that hull for a brief colour flare. One id
// for the whole fleet, not an array: the shader reads it as a single vec2 (see
// the uniform-budget note in CLAUDE.md), and two hulls being hit inside the
// same 0.6 s window is not a case worth six uniform slots.
// The relay inflates as it absorbs energy, then blasts and resets. GROW is
// how many times its base radius it reaches first; STEPS is how many energy
// arrivals that takes. STEPS is pinned at the value the old numbers implied
// ((2 - 1) / 0.02 = 50) so changing the SIZE never silently changes the
// PACING of the invasion economy -- the growth increment is derived from the
// pair rather than written as its own magic 0.02.
// Blast PACING and blast SIZE used to be one number: the relay discharged
// when it reached RELAY_GROW x its base radius, so the growth-per-shot knob
// silently controlled the cadence too -- at 1% per shot it needed 600 shots
// and effectively never fired. They are separate concerns, so they are now
// separate numbers: the blast is on a SHOT COUNT, and TUNEA.relGrow only
// decides how far it swells in those shots.
const RELAY_SHOTS = 50;                  // energy arrivals per discharge, whatever the growth
const RELAY_GROW = 7;                    // hard ceiling on the swell, as a multiple of base
const RELAY_SHRINK_MS = 2000;            // the blast deflates it over 2 s, not instantly
// The melt runs fast to MELT_KNEE (the visible collapse, at the v9.3 rate of
// 1/8 per second) and then CRAWLS the rest over MELT_TAIL seconds. Before
// this the whole melt took 8 s, so the ship you had just bombed was gone by
// the time you circled back to look at it. The wreck now sits mostly-sunk,
// and inert (hullAlive is false throughout), for well over a minute.
const MELT_KNEE = 0.78;
const MELT_TAIL = 110;                   // seconds for that last 22%
const BOLT_MAX = 6;                      // beams the shader can draw at once
const HIT_FLASH = 0.6;                   // seconds the flare stays visible
let hitId = -1, hitT0 = -1e9;            // hull id (matches mal.y), and when

// Which FACE did the bomb strike, and what does a ring lying on it look like?
// Returned in the hull's own local frame, so fx.js can re-derive the world
// position every frame and the ring keeps riding the hull as it flies on.
//   half  = local half-extents. For a ship that is [len/2, hei/2, wid/2] along
//           (lx, y, lz) -- the same axes alienBombHits tests against.
//   rot   = does the hull carry a heading (ships yes, mothership no).
function boxFace(B, hull, half, rot) {
  const ox = B.x - hull.x, oy = B.y - hull.y, oz = B.z - hull.z;
  let lx = ox, lz = oz;
  if (rot) {
    const ca = Math.cos(hull.a), sa = Math.sin(hull.a);
    lx = ox * ca - oz * sa; lz = ox * sa + oz * ca;
  }
  const l = [lx, oy, lz];
  // the face is the axis the hit sits furthest along, measured in half-extents
  // -- not in metres, or every hit on a 3500 m mothership would pick its length
  let ax = 0, best = -1;
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(l[i]) / Math.max(half[i], 1e-6);
    if (d > best) { best = d; ax = i; }
  }
  const i1 = (ax + 1) % 3, i2 = (ax + 2) % 3;
  const lp = [l[0], l[1], l[2]];
  lp[ax] = (l[ax] < 0 ? -1 : 1) * (half[ax] + 0.8);      // sit just proud of the skin
  lp[i1] = Math.max(-half[i1], Math.min(half[i1], lp[i1]));
  lp[i2] = Math.max(-half[i2], Math.min(half[i2], lp[i2]));
  const u = [0, 0, 0], v = [0, 0, 0];
  u[i1] = 1; v[i2] = 1;
  // clamped to the face so the ring cannot hang off the side it is drawn on --
  // that is what limits a hit on a harvester flank to its 60 m height
  return { lp, u, v, n: null, curv: 0,
           maxR: Math.min(HULL_BLAST_R, Math.min(half[i1], half[i2]) * 0.92) };
}

// The relay is a bulb, so its ring is a geodesic cap around the hit direction
// rather than a flat disc: it curves over the surface the way the box ring
// lies flat on a face.
function sphereFace(B, hull, R) {
  let nx = B.x - hull.x, ny = B.y - hull.y, nz = B.z - hull.z;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const a = Math.abs(ny) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = ny * a[2] - nz * a[1], uy = nz * a[0] - nx * a[2], uz = nx * a[1] - ny * a[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  return { lp: [0, 0, 0], u: [ux, uy, uz], v: [vx, vy, vz], n: [nx, ny, nz],
           curv: R, maxR: Math.min(HULL_BLAST_R, R * 1.6) };
}

function hullHit(id, B, frame, hull, rot) {
  hitId = id; hitT0 = performance.now();
  // kind 4 = a burst ON a hull. kind 3 is laid on the terrain; this one is laid
  // on the face that was actually struck, and carries a reference to the hull
  // so it keeps following it for the 0.8 s it lives.
  impacts.push({ x: B.x, y: B.y, z: B.z, t0: hitT0, kind: 4,
                 hull, rot, lp: frame.lp, u: frame.u, v: frame.v,
                 n: frame.n, curv: frame.curv, maxR: frame.maxR });
  hullExplosionSound();
}

// A laser strike is six bomb hits landing at once (LASER_DAMAGE), so the
// relay -- HP_RELAY = 6 -- melts on a single shot, which is the whole point of
// aiming at it. Geometry is NOT re-derived here: the caller has already traced
// the aim ray and says which hull it found, so this only has to apply damage
// and raise the same hit flare a bomb does. hullAlive is still the gate, so a
// falling or melting wreck absorbs nothing.
export const LASER_DAMAGE = 6;

export function alienLaserHit(id, px, py, pz) {
  const B = { x: px, y: py, z: pz };
  if (id === 0) {
    const m = alien.mother;
    if (m.gone || m.falling || m.melt > 0) return false;
    m.hp -= LASER_DAMAGE;
    hullHit(0.0, B, boxFace(B, m, [TUNEA.moWid.v / 2, TUNEA.moHei.v / 2, TUNEA.moLen.v / 2], false), m, false);
    if (m.hp <= 0) m.falling = true;
    return true;
  }
  if (id === 7) {
    const r = alien.relay;
    if (r.gone || r.falling || r.melt > 0) return false;
    r.hp -= LASER_DAMAGE;
    hullHit(7.0, B, sphereFace(B, r, r.r), r, false);
    if (r.hp <= 0) r.falling = true;
    return true;
  }
  const s = alien.ships[id - 1];
  if (!s || s.falling || s.melt > 0) return false;
  s.hp -= LASER_DAMAGE;
  hullHit(id, B, boxFace(B, s, [TUNEA.shLen.v / 2, TUNEA.shHei.v / 2, TUNEA.shWid.v / 2], true), s, true);
  if (s.hp <= 0) s.falling = true;
  return true;
}

function alienBombHits(bombs) {
  // bombs vs hulls: oriented-box tests in JS (analytic, cheap)
  for (let i = 0; i < bombs.length; i++) {
    const B = bombs[i];
    if (!B) continue;
    // mothership (axis-aligned)
    const m = alien.mother;
    if (!m.gone && !m.falling && hullDist(B.x - m.x, B.y - m.y, B.z - m.z, motherHalf()) < 3) {
      bombs[i] = null; m.hp--;
      hullHit(0.0, B, boxFace(B, m, [TUNEA.moWid.v / 2, TUNEA.moHei.v / 2, TUNEA.moLen.v / 2], false), m, false);
      if (m.hp <= 0) { m.falling = true; }
      continue;
    }
    // relay (sphere)
    const r = alien.relay;
    if (!r.gone && !r.falling && Math.hypot(B.x - r.x, B.y - r.y, B.z - r.z) < r.r + 3) {
      bombs[i] = null; r.hp--;
      hullHit(7.0, B, sphereFace(B, r, r.r), r, false);
      if (r.hp <= 0) { r.falling = true; }
      continue;
    }
    // harvesters (heading-oriented boxes)
    for (let si = 0; si < alien.ships.length; si++) {
      const s = alien.ships[si];
      if (s.falling || s.melt > 0) continue;
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      const ox = B.x - s.x, oz = B.z - s.z;
      const lx = ox * ca - oz * sa, lz = ox * sa + oz * ca;
      if (hullDist(lx, B.y - s.y, lz, shipHalf()) < 3) {
        bombs[i] = null; s.hp--;
        hullHit(si + 1.0, B, boxFace(B, s, [TUNEA.shLen.v / 2, TUNEA.shHei.v / 2, TUNEA.shWid.v / 2], true), s, true);
        if (s.hp <= 0) s.falling = true;
        break;
      }
    }
  }
}

// Is this hull still a real object? Once hp runs out it is falling, then
// melting into the terrain, then gone — and through all of that it must be
// inert to bombs AND to the player's airframe. Ships carry no `gone` flag
// (they are spliced out of alien.ships instead), which `!o.gone` handles.
const hullAlive = o => !o.gone && !o.falling && !(o.melt > 0);

// Signed distance from a point to a ROUNDED box, in the box's own frame.
// This is the same expression shipDE uses in the shader --
//   length(max(|l| - (h - r), 0)) - r
// -- so collision follows the fillet exactly rather than approximating it. At
// TUNEA.boxRound = 0 the radius is 0 and it reduces to the plain box test the
// hulls used before, so sharp hulls collide exactly as they always did.
// `pad` inflates the surface, which is how the bomb tests express their old
// tolerance: with an SDF, "within 3 m of the hull" is just d < 3.
function hullDist(lx, ly, lz, half) {
  const r = Math.min(TUNEA.boxRound.v * Math.min(half[0], Math.min(half[1], half[2])),
                     Math.min(half[0], Math.min(half[1], half[2])) * 0.98);
  const qx = Math.max(Math.abs(lx) - (half[0] - r), 0);
  const qy = Math.max(Math.abs(ly) - (half[1] - r), 0);
  const qz = Math.max(Math.abs(lz) - (half[2] - r), 0);
  const out = Math.hypot(qx, qy, qz) - r;
  if (out > 0) return out;
  // inside: the largest negative axis distance, as sdBox does
  return Math.max(Math.abs(lx) - (half[0] - r),
         Math.max(Math.abs(ly) - (half[1] - r), Math.abs(lz) - (half[2] - r))) - r;
}
// half-extents in each hull's own axis order, so the two callers agree
const motherHalf = () => [TUNEA.moWid.v / 2, TUNEA.moHei.v / 2, TUNEA.moLen.v / 2];
const shipHalf   = () => [TUNEA.shLen.v / 2, TUNEA.shHei.v / 2, TUNEA.shWid.v / 2];

// Everything an invader gathered comes back to the plane the moment it starts
// melting. This is the ONE transition for all three hull kinds, which is why
// it lives in fallAndMelt rather than in three damage paths.
//
// The tallies are LIFETIME, not a flow: a harvester keeps counting every tree
// it ever ate even after shipping the energy on, and the relay and mothership
// bank their own arrivals. So the same tree can be recovered more than once if
// you kill the whole chain. That is deliberate -- it makes every hull worth
// shooting, and a long-lived mothership a jackpot -- rather than an accounting
// slip. A harvester's live `absorbed` would have paid at most 2.
function payOutLoot(o) {
  if (!o.loot) return;
  addEnergy(o.loot);
  o.loot = 0;
}

function fallAndMelt(o, halfH, groundAt, dt) {
  // shared down-fall + terrain-melt state machine; returns true when gone
  if (o.falling) {
    o.vy -= 20 * dt;
    o.y += o.vy * dt;
    if (o.y - halfH <= groundAt) {
      o.falling = false; o.melt = 1e-4; o.vy = 0;
      payOutLoot(o);
    }
    return false;
  }
  if (o.melt > 0) {
    const rate = (o.melt < MELT_KNEE) ? 1 / 8 : (1 - MELT_KNEE) / MELT_TAIL;
    o.melt = Math.min(1, o.melt + dt * rate);
    o.y = groundAt + halfH - (2 * halfH + 8) * o.melt;   // sink into the ground
    return o.melt >= 1;
  }
  return false;
}

export function updateAliens(dt, now) {
  const m = alien.mother, r = alien.relay;
  if (!m.falling && !m.melt && !m.gone) m.y = TUNEA.moAlt.v;   // altitude slider live
  if (m.falling || m.melt > 0) {
    if (fallAndMelt(m, TUNEA.moHei.v / 2, terrainShapeJ(m.x, m.z), dt)) { m.gone = true; m.melt = 0; }
  }
  if (!r.gone) {
    if (!r.falling && r.melt === 0) {
      r.baseR = TUNEA.relSize.v / 2;
      if (r.shrinkT0 !== undefined) {
        const k = (now - r.shrinkT0) / RELAY_SHRINK_MS;
        if (k >= 1) { r.r = r.baseR; r.shrinkT0 = undefined; }
        else r.r = r.shrinkFrom + (r.baseR - r.shrinkFrom) * (k * k * (3.0 - 2.0 * k));
      }
      r.y = r.ground + 30 + r.r;
    } else if (fallAndMelt(r, r.r, r.ground, dt)) { r.gone = true; r.melt = 0; }
  }

  alienBombHits(bombs);

  for (let i = alien.ships.length - 1; i >= 0; i--) {
    const s = alien.ships[i];
    if (s.falling || s.melt > 0) {
      if (fallAndMelt(s, TUNEA.shHei.v / 2, terrainShapeJ(s.x, s.z), dt)) alien.ships.splice(i, 1);
      continue;
    }
    if (s.deploying) {
      // descend from the mothership toward the assigned plain
      const dx = s.tx - s.x, dz = s.tz - s.z;
      const d = Math.hypot(dx, dz);
      const spd = 60;
      if (d > 5) { s.x += dx / d * spd * dt; s.z += dz / d * spd * dt; s.a = Math.atan2(dx, dz); }
      const want = terrainShapeJ(s.x, s.z) + 60;
      s.y += (want - s.y) * Math.min(1, dt * 0.5);
      if (d < 30 && Math.abs(s.y - want) < 10) s.deploying = false;
      continue;
    }
    // hovering harvest run: steady drift, long axis perpendicular to motion
    s.retarget -= dt;
    const dx = s.tx - s.x, dz = s.tz - s.z;
    if (Math.hypot(dx, dz) < 120 || s.retarget <= 0) {
      const spot = alienPlainsSpot(s.x, s.z, 1600, s);   // `s` so it avoids its OWN target too
      s.tx = spot.x; s.tz = spot.z; s.retarget = 90;
    }
    const wantA = Math.atan2(s.tx - s.x, s.tz - s.z);
    let da = wantA - s.a;
    while (da > Math.PI) da -= 6.2832;
    while (da < -Math.PI) da += 6.2832;
    s.a += Math.max(-0.15 * dt, Math.min(0.15 * dt, da));
    const spd = TUNEA.shSpeed.v;
    s.x += Math.sin(s.a) * spd * dt;
    s.z += Math.cos(s.a) * spd * dt;
    const terr = terrainShapeJ(s.x, s.z);
    const want = Math.min(Math.max(terr + 45, terr + 20), terr + 100);
    s.y += (want - s.y) * Math.min(1, dt * 0.8);
    // the sweep: enqueue newly-covered tree cells through the GPU blast probe
    // (same machinery as bombs — trees pop with the circle + sound, no score)
    s.sweepAcc += spd * dt;
    if (s.sweepAcc > 6 && blastQueue.length < 3) {
      s.sweepAcc = 0;
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      const cells = [];
      const seen = {};
      for (let u = -TUNEA.shLen.v / 2; u <= TUNEA.shLen.v / 2; u += 13) {
        const px = s.x + ca * u, pz = s.z - sa * u;   // along the long axis
        const cx = Math.floor(px / 26), cz = Math.floor(pz / 26);
        const key = cx + ':' + cz;
        if (seen[key] || collectedSet.has(key)) continue;
        seen[key] = 1;
        cells.push({ x: (cx + 0.5) * 26, z: (cz + 0.5) * 26 });
      }
      if (cells.length) blastQueue.push({ cells: cells.slice(0, 64), y: s.y, uploaded: false, harvest: s });
    }
    // energy shot to the relay: every 3 trees, at most one per ~1.5 s
    if (!r.gone && !r.falling && s.absorbed >= 3 && now - s.lastShot > 1500) {
      s.absorbed -= 3; s.lastShot = now;
      // `ship` (not an index) survives another harvester being spliced out;
      // the shader resolves it back to a slot each frame and drops the beam
      // if the firing ship has since died.
      alien.bolts.push({ x0: s.x, y0: s.y, z0: s.z, x1: r.x, y1: r.y, z1: r.z, t0: now, dur: 600, big: false, done: false, ship: s, src: 0 });
      zapSound();
    }
  }

  // bolt arrivals drive the economy
  for (const b of alien.bolts) {
    if (b.done || now < b.t0 + b.dur) continue;
    b.done = true;
    if (b.big) {
      if (!m.gone && !m.falling) { m.loot = (m.loot || 0) + RELAY_SHOTS * 3; spawnHarvester(true); }   // mothership builds one more
    } else if (!r.gone && !r.falling && r.shrinkT0 === undefined) {
      r.shots = (r.shots || 0) + 1;
      r.loot = (r.loot || 0) + 3;      // an energy shot is three trees' worth
      // swell, but never past the ceiling even if the knob is wound right up
      r.r = Math.min(r.r + r.baseR * TUNEA.relGrow.v, r.baseR * RELAY_GROW);
      if (r.shots >= RELAY_SHOTS) {
        // Deflate over RELAY_SHRINK_MS rather than snapping back, and give the
        // bolt the same duration so the beam to the mothership stays lit for
        // the whole collapse instead of finishing first.
        r.shots = 0;
        r.shrinkFrom = r.r;
        r.shrinkT0 = now;
        alien.bolts.push({ x0: r.x, y0: r.y, z0: r.z, x1: m.x, y1: m.y, z1: m.z, t0: now, dur: RELAY_SHRINK_MS, big: true, done: false, ship: null, src: 6 });
        relayBlastSound();
      }
    }
  }

  // Retire spent beams. fx.js used to splice these out as it drew them; once
  // the beams moved into the shader nothing else did, and alien.bolts grew
  // without bound for the whole session -- a slow leak, and an arrival loop
  // that got longer every shot. Same 1.15 overshoot the renderer used.
  for (let i = alien.bolts.length - 1; i >= 0; i--) {
    const b = alien.bolts[i];
    if (b.done && now - b.t0 > b.dur * 1.15) alien.bolts.splice(i, 1);
  }

  // flying into a LIVE hull ends the flight. A downed one is inert — the same
  // rule alienBombHits already applies, and it has to hold here too: you are
  // by definition right next to the ship you just killed, so a lethal falling
  // wreck is an unavoidable death, and a melting one leaves an invisible
  // killbox at ground level for the 8 s it takes to sink. Reported as "the
  // game freezes when a ship goes down"; it was really an instant ALIEN HULL.
  const cp = craft.pos;
  // A hidden hull (Debug 'invasion') must not kill you either: what you
  // cannot see cannot be flown around.
  if (DBG.invasion > 0.5) {
    if (hullAlive(m) && hullDist(cp[0] - m.x, cp[1] - m.y, cp[2] - m.z, motherHalf()) < 0) doCrash('ALIEN HULL');
    if (hullAlive(r) && Math.hypot(cp[0] - r.x, cp[1] - r.y, cp[2] - r.z) < r.r) doCrash('ALIEN HULL');
    for (const s of alien.ships) {
      if (!hullAlive(s)) continue;
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      const ox = cp[0] - s.x, oz = cp[2] - s.z;
      const lx = ox * ca - oz * sa, lz = ox * sa + oz * ca;
      if (hullDist(lx, cp[1] - s.y, lz, shipHalf()) < 0) { doCrash('ALIEN HULL'); break; }
    }
  }

  // HUD tally. hullAlive, not object count: a wreck lingers ~116 s after it
  // dies, and counting objects would hold the numbers above zero long after the
  // last kill -- so INVADERS DEFEATED would never appear.
  setFleetCounts(alien.ships.filter(hullAlive).length,
                 hullAlive(r) ? 1 : 0,
                 hullAlive(m) ? 1 : 0);
}

export function packAlienUniforms(out) {
  const m = alien.mother, r = alien.relay;
  // Debug 'invasion' hidden: every hull parks at y = -99999 (the shader's own
  // "not here" convention), no lasers, no beams, no hit flash. The economy
  // underneath keeps ticking so the counters stay honest.
  const hide = DBG.invasion < 0.5;
  out.motherPos = (m.gone || hide) ? [0, -99999, 0] : [m.x, m.y, m.z];
  out.motherHalf = [TUNEA.moWid.v / 2, TUNEA.moHei.v / 2, TUNEA.moLen.v / 2];
  out.motherMelt = m.melt;
  out.relay = (r.gone || hide) ? [0, -99999, 0, 1] : [r.x, r.y, r.z, r.r];
  out.relayMelt = r.melt;
  out.shipN = hide ? 0 : alien.ships.length;
  for (let i = 0; i < SHIP_MAX; i++) {
    const s = hide ? null : alien.ships[i];
    out.shipPos[i * 4] = s ? s.x : 0;
    out.shipPos[i * 4 + 1] = s ? s.y : -99999;
    out.shipPos[i * 4 + 2] = s ? s.z : 0;
    out.shipPos[i * 4 + 3] = s ? s.a : 0;
    out.shipLaser[i] = (s && !s.falling && !s.melt && !s.deploying) ? 1 : 0;
    out.shipMelt[i] = s ? s.melt : 0;
  }
  if (hide) { out.boltN = 0; out.alienHit = [0, 0]; return; }
  out.shipHalf = [TUNEA.shLen.v / 2, TUNEA.shHei.v / 2, TUNEA.shWid.v / 2];
  out.boxParam = [TUNEA.boxScale.v, TUNEA.boxMinR.v * TUNEA.boxMinR.v, TUNEA.boxFold.v, TUNEA.bulbPow.v];
  out.boxRound = TUNEA.boxRound.v;
  // Energy beams, packed as (source id, head, tail, fade). The ENDPOINTS are
  // not sent: the shader already holds uShipPos / uRelay / uMotherPos, so a
  // beam costs one vec4 instead of six floats -- and reading them live means
  // the beam stays welded to a harvester that is still flying rather than to
  // wherever it was standing when it fired.
  const bnow = performance.now();
  let bn = 0;
  for (const bl of alien.bolts) {
    if (bn >= BOLT_MAX) break;
    const sid = bl.src === 6 ? 6 : alien.ships.indexOf(bl.ship);
    if (sid < 0) continue;                     // the firing harvester is gone
    const k = (bnow - bl.t0) / bl.dur;
    if (k < 0 || k > 1.15) continue;
    const head = Math.min(1, k);
    out.bolts[bn * 4] = sid;
    out.bolts[bn * 4 + 1] = head;
    out.bolts[bn * 4 + 2] = 0;                 // tail pinned at the source: a
    // full beam bridging ship and relay, not a short travelling dash
    out.bolts[bn * 4 + 3] = k <= 1 ? 1 : Math.max(0, 1 - (k - 1) / 0.15);
    bn++;
  }
  out.boltN = bn;

  const hitAge = (performance.now() - hitT0) / 1000;
  const fl = hitAge < HIT_FLASH ? 1.0 - hitAge / HIT_FLASH : 0.0;
  out.alienHit = [hitId, fl * fl];       // squared: flares hard, fades off quickly
}
