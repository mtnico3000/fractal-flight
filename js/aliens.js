import { TUNEA } from './tune.js';
import { craft } from './state.js';
import { terrainShapeJ } from './terrain.js';
import { collectedSet } from './spores.js';
import { bombs, impacts, blastQueue } from './weapons.js';
import { explosionSound, zapSound, relayBlastSound } from './audio.js';
import { doCrash } from './hud.js';

// ============ ALIEN INVASION (v9.0) ============
// A rectangular-mandelbox MOTHERSHIP parks high over the island. Harvester
// ships (box-cropped mandelboxes) sweep the plains with a fluo-green laser
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

function alienPlainsSpot(cx, cz, radius) {
  // find a low, harvestable spot (the plains): terrain 8..60 m
  let best = null;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * 6.2832, d = 300 + Math.random() * radius;
    const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
    const h = terrainShapeJ(x, z);
    if (h > 8 && h < 60) return { x, z };
    if (best === null || Math.abs(h - 30) < Math.abs(best.h - 30)) best = { x, z, h };
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
    absorbed: 0, lastShot: 0, sweepAcc: 0, retarget: 0,
  };
  alien.ships.push(s);
}

export function initAliens() {
  alien.mother.x = 400; alien.mother.z = 1800;
  alien.mother.y = TUNEA.moAlt.v;
  alien.mother.hp = HP_MOTHER; alien.mother.melt = 0; alien.mother.falling = false; alien.mother.vy = 0; alien.mother.gone = false;
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
  alien.relay.hp = HP_RELAY; alien.relay.melt = 0; alien.relay.falling = false; alien.relay.vy = 0; alien.relay.gone = false;
  alien.ships.length = 0;
  alien.bolts.length = 0;
  spawnHarvester(false); spawnHarvester(false);
}

function alienBombHits(bombs) {
  // bombs vs hulls: oriented-box tests in JS (analytic, cheap)
  for (let i = 0; i < bombs.length; i++) {
    const B = bombs[i];
    if (!B) continue;
    // mothership (axis-aligned)
    const m = alien.mother;
    if (!m.gone && !m.falling &&
        Math.abs(B.x - m.x) < TUNEA.moWid.v / 2 && Math.abs(B.y - m.y) < TUNEA.moHei.v / 2 + 3 && Math.abs(B.z - m.z) < TUNEA.moLen.v / 2) {
      bombs[i] = null; m.hp--; impacts.push({ x: B.x, y: B.y, z: B.z, t0: performance.now(), kind: 0 });
      explosionSound();
      if (m.hp <= 0) { m.falling = true; }
      continue;
    }
    // relay (sphere)
    const r = alien.relay;
    if (!r.gone && !r.falling && Math.hypot(B.x - r.x, B.y - r.y, B.z - r.z) < r.r + 3) {
      bombs[i] = null; r.hp--; impacts.push({ x: B.x, y: B.y, z: B.z, t0: performance.now(), kind: 0 });
      explosionSound();
      if (r.hp <= 0) { r.falling = true; }
      continue;
    }
    // harvesters (heading-oriented boxes)
    for (const s of alien.ships) {
      if (s.falling || s.melt > 0) continue;
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      const ox = B.x - s.x, oz = B.z - s.z;
      const lx = ox * ca - oz * sa, lz = ox * sa + oz * ca;
      if (Math.abs(lx) < TUNEA.shLen.v / 2 && Math.abs(B.y - s.y) < TUNEA.shHei.v / 2 + 3 && Math.abs(lz) < TUNEA.shWid.v / 2 + 3) {
        bombs[i] = null; s.hp--; impacts.push({ x: B.x, y: B.y, z: B.z, t0: performance.now(), kind: 0 });
        explosionSound();
        if (s.hp <= 0) s.falling = true;
        break;
      }
    }
  }
}

function fallAndMelt(o, halfH, groundAt, dt) {
  // shared down-fall + terrain-melt state machine; returns true when gone
  if (o.falling) {
    o.vy -= 20 * dt;
    o.y += o.vy * dt;
    if (o.y - halfH <= groundAt) { o.falling = false; o.melt = 1e-4; o.vy = 0; }
    return false;
  }
  if (o.melt > 0) {
    o.melt = Math.min(1, o.melt + dt / 8);
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
      const spot = alienPlainsSpot(s.x, s.z, 1600);
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
      alien.bolts.push({ x0: s.x, y0: s.y, z0: s.z, x1: r.x, y1: r.y, z1: r.z, t0: now, dur: 600, big: false, done: false });
      zapSound();
    }
  }

  // bolt arrivals drive the economy
  for (const b of alien.bolts) {
    if (b.done || now < b.t0 + b.dur) continue;
    b.done = true;
    if (b.big) {
      if (!m.gone && !m.falling) spawnHarvester(true);   // mothership builds one more
    } else if (!r.gone && !r.falling) {
      r.r += r.baseR * 0.02;                              // relay grows very slightly
      if (r.r >= r.baseR * 2) {
        r.r = r.baseR;
        alien.bolts.push({ x0: r.x, y0: r.y, z0: r.z, x1: m.x, y1: m.y, z1: m.z, t0: now, dur: 1200, big: true, done: false });
        relayBlastSound();
      }
    }
  }

  // flying into a hull ends the flight
  const cp = craft.pos;
  if (!m.gone && Math.abs(cp[0] - m.x) < TUNEA.moWid.v / 2 && Math.abs(cp[1] - m.y) < TUNEA.moHei.v / 2 && Math.abs(cp[2] - m.z) < TUNEA.moLen.v / 2) doCrash('ALIEN HULL');
  if (!r.gone && Math.hypot(cp[0] - r.x, cp[1] - r.y, cp[2] - r.z) < r.r) doCrash('ALIEN HULL');
  for (const s of alien.ships) {
    const ca = Math.cos(s.a), sa = Math.sin(s.a);
    const ox = cp[0] - s.x, oz = cp[2] - s.z;
    const lx = ox * ca - oz * sa, lz = ox * sa + oz * ca;
    if (Math.abs(lx) < TUNEA.shLen.v / 2 && Math.abs(cp[1] - s.y) < TUNEA.shHei.v / 2 && Math.abs(lz) < TUNEA.shWid.v / 2) { doCrash('ALIEN HULL'); break; }
  }
}

export function packAlienUniforms(out) {
  const m = alien.mother, r = alien.relay;
  out.motherPos = m.gone ? [0, -99999, 0] : [m.x, m.y, m.z];
  out.motherHalf = [TUNEA.moWid.v / 2, TUNEA.moHei.v / 2, TUNEA.moLen.v / 2];
  out.motherMelt = m.melt;
  out.relay = r.gone ? [0, -99999, 0, 1] : [r.x, r.y, r.z, r.r];
  out.relayMelt = r.melt;
  out.shipN = alien.ships.length;
  for (let i = 0; i < SHIP_MAX; i++) {
    const s = alien.ships[i];
    out.shipPos[i * 4] = s ? s.x : 0;
    out.shipPos[i * 4 + 1] = s ? s.y : -99999;
    out.shipPos[i * 4 + 2] = s ? s.z : 0;
    out.shipPos[i * 4 + 3] = s ? s.a : 0;
    out.shipLaser[i] = (s && !s.falling && !s.melt && !s.deploying) ? 1 : 0;
    out.shipMelt[i] = s ? s.melt : 0;
  }
  out.shipHalf = [TUNEA.shLen.v / 2, TUNEA.shHei.v / 2, TUNEA.shWid.v / 2];
  out.boxParam = [TUNEA.boxScale.v, TUNEA.boxMinR.v * TUNEA.boxMinR.v, TUNEA.boxFold.v, TUNEA.bulbPow.v];
}
