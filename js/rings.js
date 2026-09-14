import { START, MAX_RINGS, LAND_MIN_H } from './config.js';
import { craft } from './state.js';
import { normalize3, cross3 } from './math.js';
import { terrainShapeJ } from './terrain.js';
import { ringSound } from './audio.js';
import { DBG } from './dbg.js';

// ============ RING COURSE (ported from jul's fractal-flight) ============
// Fly through rings to score. Spawning chains ring-to-ring and fans its
// candidate directions wider on retries so the course turns back over
// mountains instead of drifting out to sea (jul's land-seeking fix).
export const rings = [];
let ringScore = 0;
export const ringsPosData = new Float32Array(MAX_RINGS * 4);
export const ringsMatsData = new Float32Array(MAX_RINGS * 9);
const $ringScore = document.getElementById('ringScore');
const $ringsBox = document.getElementById('rings-score');

export function initRings() {
  ringScore = 0;
  $ringScore.textContent = 0;
  prevPos = null;
  rings.length = 0;
  for (let i = 0; i < MAX_RINGS; i++) {
    rings.push({ pos: [0,0,0], fwd: [0,0,1], right: [1,0,0], up: [0,1,0], radius: 18, active: false, behindT: 0 });
  }
  let lastPos = [START.x, START.y, START.z];
  let lastFwd = [0, 0, 1];
  for (let i = 0; i < MAX_RINGS; i++) {
    spawnRing(i, lastPos, lastFwd);
    lastPos = rings[i].pos;
    lastFwd = rings[i].fwd;
  }
}

function spawnRing(index, fromPos, fromFwd) {
  // Fan of candidate directions: early attempts follow the chain heading,
  // later ones swing wider; fall back to the highest terrain seen.
  const baseYaw = Math.atan2(fromFwd[0], fromFwd[2]);
  let best = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const spread = 0.4 + 2.0 * attempt / 11;
    const yaw = baseYaw + (Math.random() - 0.5) * spread;
    const dist = 400 + Math.random() * 300;
    const x = fromPos[0] + Math.sin(yaw) * dist;
    const z = fromPos[2] + Math.cos(yaw) * dist;
    const h = terrainShapeJ(x, z);
    if (best === null || h > best.h) best = { x, z, h };
    if (h > LAND_MIN_H) { best = { x, z, h }; break; }
  }

  // Above terrain with generous clearance, and a minimum flying altitude
  const clearance = 100 + Math.random() * 120;
  const pos = [best.x, Math.max(best.h + clearance, 150), best.z];

  let fwd = normalize3([pos[0] - fromPos[0], pos[1] - fromPos[1], pos[2] - fromPos[2]]);
  let right = normalize3(cross3(fwd, [0, 1, 0]));
  if (!isFinite(right[0])) right = [1, 0, 0];
  let up = cross3(right, fwd);

  rings[index].pos = pos;
  rings[index].fwd = fwd;
  rings[index].right = right;
  rings[index].up = up;
  rings[index].radius = 18;
  rings[index].behindT = 0;
  rings[index].active = true;
}

let prevPos = null;   // last frame's craft position, for the plane-crossing test

export function updateRings(craftPos, craftFwd, dt) {
  if (prevPos === null) prevPos = [craftPos[0], craftPos[1], craftPos[2]];
  const segX = craftPos[0] - prevPos[0], segY = craftPos[1] - prevPos[1], segZ = craftPos[2] - prevPos[2];
  const teleported = segX * segX + segY * segY + segZ * segZ > 400 * 400;   // R-reset jump: no false crossings

  for (let i = 0; i < MAX_RINGS; i++) {
    const r = rings[i];
    if (!r.active) continue;

    // Pass detection (v6.0): the old test was a sphere around the ring CENTER
    // (0.8 x radius) plus an approach-angle gate, so passes near the rim were
    // missed. Now the frame's flight segment is intersected with the ring's
    // PLANE: a crossing anywhere inside the full opening counts, at any
    // speed, from any angle.
    if (!teleported) {
      const pz = (prevPos[0] - r.pos[0]) * r.fwd[0] + (prevPos[1] - r.pos[1]) * r.fwd[1] + (prevPos[2] - r.pos[2]) * r.fwd[2];
      const cz = (craftPos[0] - r.pos[0]) * r.fwd[0] + (craftPos[1] - r.pos[1]) * r.fwd[1] + (craftPos[2] - r.pos[2]) * r.fwd[2];
      if ((pz < 0) !== (cz < 0)) {
        const t = pz / (pz - cz);   // where the segment crosses the ring plane
        const hx = prevPos[0] + segX * t - r.pos[0];
        const hy = prevPos[1] + segY * t - r.pos[1];
        const hz = prevPos[2] + segZ * t - r.pos[2];
        const rx = hx * r.right[0] + hy * r.right[1] + hz * r.right[2];
        const ry = hx * r.up[0] + hy * r.up[1] + hz * r.up[2];
        if (rx * rx + ry * ry <= r.radius * r.radius) {
          ringScore++;
          $ringScore.textContent = ringScore;
          pulseRingScore();
          ringSound();
          r.active = false;
          spawnNextRing(i, craftPos);
          continue;
        }
      }
    }

    // Behind housekeeping (v6.0): recycling used to be INSTANT — during a
    // loop the forward vector reverses for a couple of seconds, every ring
    // read as "behind", and the whole course respawned far away (the rings
    // seemed to vanish). A ring must now stay behind for 4 continuous
    // seconds, longer than any loop's reversed phase, before recycling.
    const behindDot = (r.pos[0] - craftPos[0]) * craftFwd[0] +
                      (r.pos[1] - craftPos[1]) * craftFwd[1] +
                      (r.pos[2] - craftPos[2]) * craftFwd[2];
    if (behindDot < -200) {
      r.behindT += dt;
      if (r.behindT > 4.0) {
        r.active = false;
        spawnNextRing(i, craftPos);
      }
    } else {
      r.behindT = 0;
    }
  }

  prevPos[0] = craftPos[0]; prevPos[1] = craftPos[1]; prevPos[2] = craftPos[2];
}

function spawnNextRing(index, craftPos) {
  // Chain from the furthest active ring so the course keeps extending
  let furthestIdx = -1;
  let maxDistSq = -1;
  for (let j = 0; j < MAX_RINGS; j++) {
    if (rings[j].active) {
      const fdx = rings[j].pos[0] - craftPos[0];
      const fdy = rings[j].pos[1] - craftPos[1];
      const fdz = rings[j].pos[2] - craftPos[2];
      const dsq = fdx * fdx + fdy * fdy + fdz * fdz;
      if (dsq > maxDistSq) { maxDistSq = dsq; furthestIdx = j; }
    }
  }
  if (furthestIdx === -1) {
    const hf = normalize3([craft.f[0], 0, craft.f[2]]);
    spawnRing(index, craftPos, isFinite(hf[0]) ? hf : [0, 0, 1]);
  } else {
    spawnRing(index, rings[furthestIdx].pos, rings[furthestIdx].fwd);
  }
}

export function packRingData() {
  for (let i = 0; i < MAX_RINGS; i++) {
    const r = rings[i];
    // Debug 'rings' hidden: radius -1 is the shader's own "no ring here"
    if (r.active && DBG.ringsOn > 0.5) {
      ringsPosData[i*4]   = r.pos[0];
      ringsPosData[i*4+1] = r.pos[1];
      ringsPosData[i*4+2] = r.pos[2];
      ringsPosData[i*4+3] = r.radius;
      ringsMatsData[i*9]   = r.right[0];
      ringsMatsData[i*9+1] = r.right[1];
      ringsMatsData[i*9+2] = r.right[2];
      ringsMatsData[i*9+3] = r.up[0];
      ringsMatsData[i*9+4] = r.up[1];
      ringsMatsData[i*9+5] = r.up[2];
      ringsMatsData[i*9+6] = r.fwd[0];
      ringsMatsData[i*9+7] = r.fwd[1];
      ringsMatsData[i*9+8] = r.fwd[2];
    } else {
      ringsPosData[i*4+3] = -1.0;
    }
  }
}

function pulseRingScore() {
  $ringsBox.style.transform = 'translateX(-50%) scale(1.3)';
  setTimeout(() => { $ringsBox.style.transform = 'translateX(-50%) scale(1)'; }, 150);
}
