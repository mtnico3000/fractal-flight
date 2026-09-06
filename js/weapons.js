import { WATER_LEVEL, MAXB, BULLET_SPEED, BULLET_RANGE, MAXBOMB, BLAST_R, BLASTC, RING_N, BOMB_BOOST } from './config.js';
import { craft, craftB, flags, pilotAim } from './state.js';
import { TUNE } from './tune.js';
import { terrainShapeJ } from './terrain.js';
import { fireSound, bombDropSound, explosionSound } from './audio.js';
import { collectTreeAt, collectedSet } from './spores.js';

// ============ GUNS (v3.2) ============
// Max 8 tracer rounds in the air. Fixed slots so each round keeps the same
// probe-pixel pair for its whole flight. Hit detection reuses the GPU probe
// row: the shader answers terrain height + plant distance at every bullet
// position in the same readPixels the craft already does — zero extra draws.
export const bullets = new Array(MAXB).fill(null);
export const bulletUniform  = new Float32Array(MAXB * 3).fill(-9999); // uploaded this frame
export const bulletProbePos = new Float32Array(MAXB * 3).fill(-9999); // what the GPU answered for
export const gpuBulletGround = new Float32Array(MAXB).fill(-9999);
export const gpuBulletPlant  = new Float32Array(MAXB).fill(99);
export const impacts = [];          // short-lived rings where a round hit ground/water

export function fireGun() {
  if (flags.crashed) return;
  let slot = -1;
  for (let i = 0; i < MAXB; i++) if (!bullets[i]) { slot = i; break; }
  if (slot < 0) return;      // all 8 tracers airborne — wait for one to land
  const b = pilotAim.on ? pilotAim : craftB();   // cockpit view: shoot where you look
  const sp = craft.speed + BULLET_SPEED;
  const B = {
    x: craft.pos[0] + b.fwd[0] * 4.0,   // nose tip
    y: craft.pos[1] + b.fwd[1] * 4.0,
    z: craft.pos[2] + b.fwd[2] * 4.0,
    vx: b.fwd[0] * sp, vy: b.fwd[1] * sp, vz: b.fwd[2] * sp,
    px: 0, py: 0, pz: 0,                // previous position = tracer segment tail
    dist: 0, age: 0                     // age gates collision until the probe has answered
  };
  B.px = B.x; B.py = B.y; B.pz = B.z;
  bullets[slot] = B;
  fireSound();
}

export function updateBullets(dt) {
  for (let i = 0; i < MAXB; i++) {
    const B = bullets[i];
    if (!B) continue;
    // ---- collision, from last frame's GPU answer (valid once age >= 1) ----
    if (B.age >= 1) {
      const seg = Math.hypot(B.vx, B.vy, B.vz) * dt;
      if (gpuBulletPlant[i] < Math.max(2.5, seg * 0.6)) {
        // tree hit → pop it exactly like flying through it (probe pos owns the cell)
        collectTreeAt(bulletProbePos[i * 3], bulletProbePos[i * 3 + 1], bulletProbePos[i * 3 + 2]);
        bullets[i] = null; continue;
      }
      if (B.y < gpuBulletGround[i] + 0.3) {
        impacts.push({ x: B.x, y: gpuBulletGround[i] + 0.5, z: B.z, t0: performance.now(), kind: 0 });
        bullets[i] = null; continue;
      }
      if (B.y < WATER_LEVEL) {
        impacts.push({ x: B.x, y: WATER_LEVEL + 0.2, z: B.z, t0: performance.now(), kind: 2 });
        bullets[i] = null; continue;
      }
    }
    // ---- ballistics: straight shot bent by gravity into a shallow arc ----
    B.px = B.x; B.py = B.y; B.pz = B.z;
    B.x += B.vx * dt; B.y += B.vy * dt; B.z += B.vz * dt;
    B.vy -= 9.81 * dt;
    B.dist += Math.hypot(B.vx, B.vy, B.vz) * dt;
    B.age++;
    if (B.dist > BULLET_RANGE) bullets[i] = null;   // tracer burnout
  }
}
// ============ BOMBS (v3.3, lobbed v3.4, fixed v3.5, 45° launch v3.7) ============
// Right-click launches one diving forward. Max 3 in the air; a slot frees
// when its bomb lands. The bomb departs diving BELOW the horizontal heading
// at a tune-panel angle (default 20°): horizontal speed is the plane's speed
// plus BOMB_BOOST (so it always pulls ahead, never drifts back toward the
// camera). Pure gravity after release curves the dive steeper.
// Detonation is GPU-authoritative: the impact enqueues candidate cells around
// ground zero; the shader answers next frame which of them hold a living
// tree, and only those pop and score.
export const bombs = new Array(MAXBOMB).fill(null);
export const bombUniform = new Float32Array(MAXBOMB * 3).fill(-9999);
export const gpuBombGround = new Float32Array(MAXBOMB).fill(-9999);
export const blastQueue = [];       // detonations awaiting their cell probe
export let activeBlast = null;      // the one currently uploaded / resolving
export const blastUniform = new Float32Array(BLASTC * 2).fill(1e7);
export const gpuBlastPlant = new Float32Array(BLASTC).fill(40);

export function dropBomb() {
  if (flags.crashed) return;
  let slot = -1;
  for (let i = 0; i < MAXBOMB; i++) if (!bombs[i]) { slot = i; break; }
  if (slot < 0) return;      // 3 already falling — wait for a hit
  const b = pilotAim.on ? pilotAim : craftB();   // cockpit view: bomb where you look
  // boost direction: horizontal heading (nose direction, dive angle removed)
  let hx = b.fwd[0], hz = b.fwd[2];
  const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
  // launch along the plane's own flight path, angled down a further
  // bombAngle (tune panel, default 1°) — a diving plane throws the bomb
  // steeper, a climbing plane lobs it (v5.4); gravity curves it from there
  const vh = craft.speed + BOMB_BOOST;
  const pAng = -Math.asin(Math.max(-1, Math.min(1, b.fwd[1])));   // + when diving
  const tot = pAng + TUNE.bombAngle.v * Math.PI / 180;
  bombs[slot] = {
    x: craft.pos[0] + b.fwd[0] * 2.0 - b.up[0] * 2.0,
    y: craft.pos[1] + b.fwd[1] * 2.0 - b.up[1] * 2.0,
    z: craft.pos[2] + b.fwd[2] * 2.0 - b.up[2] * 2.0,
    vx: hx * vh * Math.cos(tot), vy: -vh * Math.sin(tot), vz: hz * vh * Math.cos(tot),
    age: 0
  };
  bombDropSound();
}

export function updateBombs(dt) {
  for (let i = 0; i < MAXBOMB; i++) {
    const B = bombs[i];
    if (!B) continue;
    if (B.age >= 1) {
      if (B.y < gpuBombGround[i] + 0.6) {
        detonate(B.x, gpuBombGround[i] + 0.6, B.z, 0);
        bombs[i] = null; continue;
      }
      if (B.y < WATER_LEVEL) {
        detonate(B.x, WATER_LEVEL + 0.2, B.z, 2);   // splash, but shore trees in range still pop
        bombs[i] = null; continue;
      }
    }
    B.vy = Math.max(-160, B.vy - 9.81 * dt);        // gravity, light terminal velocity
    B.x += B.vx * dt;
    B.y += B.vy * dt;
    B.z += B.vz * dt;
    B.age++;
  }
}

function ringHeights(x, y, z, overWater) {
  // sampled ONCE per detonation: actual terrain height at RING_N points on
  // the full-radius circle, so the visual ring drapes over the real slope
  // (JS terrain mirror; close enough for an overlay effect). Water flattens.
  const h = new Float32Array(RING_N);
  for (let k = 0; k < RING_N; k++) {
    if (overWater) { h[k] = y; continue; }
    const a = (k / RING_N) * 6.28318;
    let gh = terrainShapeJ(x + Math.cos(a) * BLAST_R, z + Math.sin(a) * BLAST_R);
    if (gh < WATER_LEVEL) gh = WATER_LEVEL;
    h[k] = gh + 1.5;
  }
  return h;
}

function detonate(x, y, z, kind) {
  impacts.push({ x, y, z, t0: performance.now(), kind: 3, ringH: ringHeights(x, y, z, kind === 2) });
  if (kind === 2) impacts.push({ x, y, z, t0: performance.now(), kind: 2 });
  explosionSound();
  // candidate cells: any cell whose tree (center jitter ±6 m) could sit
  // inside the blast radius (worst case 12 cells at r=40+6 with 26 m cells).
  const R = BLAST_R + 6;
  const cells = [];
  for (let cx = Math.floor((x - R) / 26); cx <= Math.floor((x + R) / 26); cx++) {
    for (let cz = Math.floor((z - R) / 26); cz <= Math.floor((z + R) / 26); cz++) {
      if (collectedSet.has(cx + ':' + cz)) continue;
      const ccx = (cx + 0.5) * 26, ccz = (cz + 0.5) * 26;
      const d = Math.hypot(ccx - x, ccz - z);
      if (d <= R) cells.push({ x: ccx, z: ccz, d });
    }
  }
  cells.sort((a, b) => a.d - b.d);
  cells.length = Math.min(cells.length, BLASTC);
  if (cells.length) blastQueue.push({ cells, y, uploaded: false });
}

export function resolveBlasts() {
  // called each live frame: settle the probed blast, then arm the next one
  if (activeBlast && activeBlast.uploaded) {
    for (let j = 0; j < activeBlast.cells.length; j++) {
      if (gpuBlastPlant[j] < 38) {   // shader says: living tree in this cell
        const c = activeBlast.cells[j];
        const got = collectTreeAt(c.x, activeBlast.y, c.z, Math.min(j * 0.03, 1.1), !!activeBlast.harvest);   // staggered pops; alien harvests score nothing
        if (got && activeBlast.harvest) activeBlast.harvest.absorbed++;
      }
    }
    activeBlast = null;
  }
  if (!activeBlast && blastQueue.length) activeBlast = blastQueue.shift();
}

// full clear on reset (R): every airborne round, bomb and pending blast dies
export function clearWeapons() {
  bullets.fill(null);
  bombs.fill(null);
  blastQueue.length = 0;
  activeBlast = null;
  impacts.length = 0;
}
