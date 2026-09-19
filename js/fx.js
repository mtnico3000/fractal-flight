// 2D overlay effects: wingtip contrails, tracer glow, falling-bomb blink,
// impact/blast/harvest rings — world-space particles projected onto the fx
// canvas each frame, zero cost inside the raymarcher.

import { TAN_HALF_FOV, TRAIL_LIFE, POP_LIFE, MAXB, MAXBOMB, RING_N, BLAST_R,
         FXQ, FXQ_TRAIL, FXQ_BULLET, FXQ_BOMB, FXQ_RING } from './config.js';
import { craft, viewPos } from './state.js';

const fxCanvas = document.getElementById('fx');
const fxCtx = fxCanvas.getContext('2d');
export const fxOcc = { vis: new Uint8Array(FXQ) };   // 255 = fully visible (GPU probe answers)
fxOcc.vis.fill(255);
let fxFrame = 0;                                     // round-robin clock, one tick per build

// How long a ring of each kind stays on screen. The query builder and the
// draw loop BOTH need this: a slot spent on a ring nobody draws is a slot
// wasted, and that was the whole bug (see slotRings below).
function impactLife(kind) { return kind === 3 ? 0.9 : (kind === 4 ? 0.8 : 0.45); }

// Visibility of an overlay particle: its last latched probe answer. Undefined
// means "never answered", which now only happens when more rings become live
// in ONE frame than the pool has slots — `slotRings` serves the unanswered
// first, so in practice a ring has an answer before its first drawn frame.
const fxVis = p => (p._vis !== undefined ? p._vis : 1);

// Latch this frame's probe answers onto the particles that held a slot, by
// SLOT rather than at the point of drawing. That distinction is load bearing:
// a blast pushes up to BLASTC pops at once with start times staggered over
// 1.1 s, so most of them are not drawn for another second — stamping `_vt`
// where a particle is DRAWN would leave those dormant pops permanently
// "never answered", sorting them to the front of every round and starving the
// handful actually on screen.
function latchFxVis(list) {
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p && p._q !== undefined) { p._vis = fxOcc.vis[p._q] / 255; p._vt = fxFrame; }
  }
}

// Hands the shared ring pool to the rings that are actually being DRAWN this
// frame, longest-unanswered first.
//
// This is the fix for "harvest rings show through the mountains". The old rule
// took the LAST ten entries of `pops` — and after a blast those are the worst
// possible ten: `collectTreeAt` staggers the pops by `j * 0.03` s, so the
// newest entries are the ones that have not STARTED yet, while every pop
// actually on screen fell through to `_q === undefined`, scored vv = 1, and
// was painted straight over the ridge in front of it. ~40 rings are live at
// once during a blast against a 0.7 s life, so this was the common case, not
// an edge one.
//
// Round robin over the live set fixes both halves: nothing waits more than a
// frame or two for a fresh answer, and a ring that has never been answered
// sorts first, so it is never drawn blind.
function slotRings(now, impacts, arr) {
  const live = [];
  for (let i = 0; i < pops.length; i++) {
    const p = pops[i], age = (now - p.t0) / 1000;
    if (age >= 0 && age <= POP_LIFE) live.push(p); else p._q = undefined;
  }
  for (let i = 0; i < impacts.length; i++) {
    const p = impacts[i], age = (now - p.t0) / 1000;
    if (age >= 0 && age <= impactLife(p.kind)) live.push(p); else p._q = undefined;
  }
  const age = p => (p._vt === undefined ? -1e9 : p._vt);   // never answered = oldest
  live.sort((a, b) => age(a) - age(b));
  const n = FXQ - FXQ_RING;
  for (let k = 0; k < live.length; k++) {
    const p = live[k];
    if (k >= n) { p._q = undefined; continue; }
    const q = FXQ_RING + k;
    p._q = q; arr[q * 3] = p.x; arr[q * 3 + 1] = p.y; arr[q * 3 + 2] = p.z;
  }
}

// Assigns every overlay particle an occlusion-query slot and packs the query
// positions for the GPU probe (row px 85 .. 85+FXQ-1). FXQ_* in config.js is
// the one map of who gets which slot. Two strategies, by particle class:
//
//   - one slot each (bullets, bombs): few, and each is a single bright object
//     whose visibility must be exact every frame.
//   - shared slots (trail, rings): many, and clustered. The contrail has done
//     this since v7.9 — 700 dots sampled at 16 points along the polyline —
//     and the rings now do it too, but ROUND ROBIN rather than by position.
export function buildFxQueries(arr, now, bullets, bombs, impacts) {
  fxFrame++;
  for (let i = 0; i < FXQ; i++) { arr[i * 3] = viewPos[0]; arr[i * 3 + 1] = viewPos[1]; arr[i * 3 + 2] = viewPos[2]; }
  const n = trail.length;
  const tN = FXQ_BULLET - FXQ_TRAIL;
  if (n > 0) {
    for (let s = 0; s < tN; s++) {
      const p = trail[Math.min(n - 1, Math.round(s * (n - 1) / (tN - 1)))];
      const q = FXQ_TRAIL + s;
      arr[q * 3] = p.x; arr[q * 3 + 1] = p.y; arr[q * 3 + 2] = p.z;
    }
    for (let i = 0; i < n; i++) trail[i]._q = FXQ_TRAIL + (n > 1 ? Math.round(i * (tN - 1) / (n - 1)) : 0);
  }
  for (let i = 0; i < MAXB; i++) {
    const B = bullets[i];
    if (!B) continue;
    const q = FXQ_BULLET + i;
    arr[q * 3] = B.x; arr[q * 3 + 1] = B.y; arr[q * 3 + 2] = B.z; B._q = q;
  }
  for (let i = 0; i < MAXBOMB; i++) {
    const B = bombs[i];
    if (!B) continue;
    const q = FXQ_BOMB + i;
    arr[q * 3] = B.x; arr[q * 3 + 1] = B.y; arr[q * 3 + 2] = B.z; B._q = q;
  }
  slotRings(now, impacts, arr);
}

export const trail = [];
export const pops = [];            // expanding rings where a spore was harvested
export function emitTrail(b, now, boost) {
  for (const side of [-1, 1]) {
    trail.push({
      x: craft.pos[0] + b.right[0] * 3.0 * side - b.fwd[0] * 0.4,
      y: craft.pos[1] + b.right[1] * 3.0 * side - b.fwd[1] * 0.4,
      z: craft.pos[2] + b.right[2] * 3.0 * side - b.fwd[2] * 0.4,
      t0: now, boost
    });
  }
  while (trail.length > 700) trail.shift();   // longer life needs more dots
}
function projectFx(camB, px, py, pz, W, H) {
  const vx = px - viewPos[0], vy = py - viewPos[1], vz = pz - viewPos[2];
  const lz = vx * camB.fwd[0] + vy * camB.fwd[1] + vz * camB.fwd[2];
  if (lz < 1.0) return null;
  const lx = vx * camB.right[0] + vy * camB.right[1] + vz * camB.right[2];
  const ly = vx * camB.up[0] + vy * camB.up[1] + vz * camB.up[2];
  const ux = lx / (lz * TAN_HALF_FOV), uy = ly / (lz * TAN_HALF_FOV);
  return { x: (ux * H + W) / 2, y: H * (1 - uy) / 2, z: lz };
}

// The alien energy beams used to be drawn here as 2D lines. They are now 3D
// in the fragment shader (see uBolts in shaders.js): the overlay has no depth
// buffer, so a beam behind a mountain was painted straight over it.

export function drawTrail(camB, now, bullets, bombs, impacts) {
  const W = fxCanvas.clientWidth, H = fxCanvas.clientHeight;
  if (fxCanvas.width !== W || fxCanvas.height !== H) { fxCanvas.width = W; fxCanvas.height = H; }
  fxCtx.clearRect(0, 0, W, H);
  // the probe row came back between buildFxQueries() and here
  latchFxVis(trail); latchFxVis(bullets); latchFxVis(bombs);
  latchFxVis(pops); latchFxVis(impacts);
  // tracer rounds: additive warm glow + bright core along this frame's segment
  fxCtx.globalCompositeOperation = 'lighter';
  fxCtx.lineCap = 'round';
  for (let i = 0; i < MAXB; i++) {
    const B = bullets[i];
    if (!B) continue;
    const a = projectFx(camB, B.px, B.py, B.pz, W, H);
    const c = projectFx(camB, B.x, B.y, B.z, W, H);
    if (!a || !c) continue;
    const fade = Math.max(0.25, 1 - c.z / 1500);
    const vv = fxVis(B);
    if (vv < 0.02) continue;
    fxCtx.beginPath(); fxCtx.moveTo(a.x, a.y); fxCtx.lineTo(c.x, c.y);
    fxCtx.strokeStyle = 'rgba(255,185,80,' + (0.35 * fade * vv).toFixed(3) + ')';
    fxCtx.lineWidth = Math.max(2.5, 240 / c.z);
    fxCtx.stroke();
    fxCtx.beginPath(); fxCtx.moveTo(a.x, a.y); fxCtx.lineTo(c.x, c.y);
    fxCtx.strokeStyle = 'rgba(255,246,214,' + (0.9 * fade * vv).toFixed(3) + ')';
    fxCtx.lineWidth = Math.max(1, 90 / c.z);
    fxCtx.stroke();
  }
  fxCtx.globalCompositeOperation = 'source-over';
  // falling bombs: slow black↔yellow blink (per-slot phase) + glint + streak
  for (let i = 0; i < MAXBOMB; i++) {
    const B = bombs[i];
    if (!B) continue;
    const s = projectFx(camB, B.x, B.y, B.z, W, H);
    if (!s) continue;
    const vv = fxVis(B);
    if (vv < 0.02) continue;
    const t = projectFx(camB, B.x - B.vx * 0.06, B.y - B.vy * 0.06, B.z - B.vz * 0.06, W, H);
    const r = Math.max(3.2, 220 / s.z);   // v5.3: doubled
    if (t) {
      fxCtx.beginPath(); fxCtx.moveTo(t.x, t.y); fxCtx.lineTo(s.x, s.y);
      fxCtx.strokeStyle = 'rgba(60,60,70,' + (0.35 * vv).toFixed(3) + ')'; fxCtx.lineWidth = r * 0.6; fxCtx.stroke();
    }
    const bl = 0.5 + 0.5 * Math.sin(now * 0.016 + i * 2.1);   // ~0.4 s blink cycle (v5.3: quicker)
    const cr2 = Math.round(38 + (255 - 38) * bl);
    const cg = Math.round(38 + (210 - 38) * bl);
    const cb = Math.round(46 + (60 - 46) * bl);
    fxCtx.beginPath(); fxCtx.arc(s.x, s.y, r, 0, 6.2832);
    fxCtx.fillStyle = 'rgba(' + cr2 + ',' + cg + ',' + cb + ',' + (0.95 * vv).toFixed(3) + ')'; fxCtx.fill();
    fxCtx.beginPath(); fxCtx.arc(s.x - r * 0.3, s.y - r * 0.3, r * 0.3, 0, 6.2832);
    fxCtx.fillStyle = 'rgba(255,255,255,' + (0.5 * vv).toFixed(3) + ')'; fxCtx.fill();
  }
  // bullet impacts: quick dust (ground) / spray (water) rings;
  // kind 3 = bomb detonation: a world-space ring LYING ON THE TERRAIN,
  // expanding to the true blast radius — each vertex sits at sampled ground
  // height and is projected in perspective, so the circle tilts with slopes.
  for (let i = impacts.length - 1; i >= 0; i--) {
    const p = impacts[i];
    const life = impactLife(p.kind);
    const age = (now - p.t0) / 1000;
    if (age > life) { impacts.splice(i, 1); continue; }
    const k = age / life;
    const vv = fxVis(p);
    if (vv < 0.02) continue;
    if (p.kind === 4) {
      // Alien hull detonation. kind 3 below lies on the TERRAIN; this one lies
      // on the HULL. aliens.js hands over the struck face as a frame in the
      // hull's own local space -- an origin plus two in-plane axes, or a normal
      // plus a radius for the relay bulb -- and the hull object itself, so the
      // ring is re-derived in world space every frame. That does both things a
      // billboard could not: it wraps the side that was actually hit instead of
      // facing the camera, and it rides a harvester that is still moving (at
      // 30 m/s a static ring drifts 24 m off the ship inside its own lifetime).
      const h = p.hull;
      const ca = p.rot ? Math.cos(h.a) : 1, sa = p.rot ? Math.sin(h.a) : 0;
      const toW = l => [h.x + l[0] * ca + l[2] * sa, h.y + l[1], h.z - l[0] * sa + l[2] * ca];
      const toD = d => (p.rot ? [d[0] * ca + d[2] * sa, d[1], -d[0] * sa + d[2] * ca] : d);
      const oW = toW(p.lp), uW = toD(p.u), vW = toD(p.v), nW = p.curv > 0 ? toD(p.n) : null;
      p.x = oW[0]; p.y = oW[1]; p.z = oW[2];    // keep the occlusion probe on the hull
      const dx = p.x - viewPos[0], dy = p.y - viewPos[1], dz = p.z - viewPos[2];
      const dist = Math.max(20, Math.hypot(dx, dy, dz));
      const pxPerM = H / (2 * dist * TAN_HALF_FOV);
      const frac = Math.min(1, k * 2.0);
      fxCtx.globalCompositeOperation = 'lighter';
      const cs = projectFx(camB, p.x, p.y, p.z, W, H);
      if (cs && k < 0.32) {
        // Deliberately dim. Under 'lighter', over an already-lit hull, a near
        // white core blew out into a hard camera-flash blink instead of reading
        // as a detonation, so this is half the alpha and half the radius it was.
        fxCtx.beginPath();
        fxCtx.arc(cs.x, cs.y, Math.max(1.5, 7 * pxPerM * (1 - k * 3.1) + 1.5), 0, 6.2832);
        fxCtx.fillStyle = 'rgba(170,205,240,' + Math.max(0, 0.30 * (1 - k * 3.1) * vv).toFixed(3) + ')';
        fxCtx.fill();
      }
      const traceHull = (fr) => {
        const r = p.maxR * fr;
        if (r < 0.05) return false;
        let started = false, drew = false;
        fxCtx.beginPath();
        for (let q = 0; q <= RING_N; q++) {
          const th = ((q % RING_N) / RING_N) * 6.28318;
          const c = Math.cos(th), sn = Math.sin(th);
          let wx, wy, wz;
          if (nW) {                                // geodesic cap over the bulb
            const ph = Math.min(r / p.curv, 2.4), cp = Math.cos(ph), sp = Math.sin(ph);
            wx = oW[0] + p.curv * (cp * nW[0] + sp * (c * uW[0] + sn * vW[0]));
            wy = oW[1] + p.curv * (cp * nW[1] + sp * (c * uW[1] + sn * vW[1]));
            wz = oW[2] + p.curv * (cp * nW[2] + sp * (c * uW[2] + sn * vW[2]));
          } else {                                 // flat ring lying on the face
            wx = oW[0] + (c * uW[0] + sn * vW[0]) * r;
            wy = oW[1] + (c * uW[1] + sn * vW[1]) * r;
            wz = oW[2] + (c * uW[2] + sn * vW[2]) * r;
          }
          const sp2 = projectFx(camB, wx, wy, wz, W, H);
          if (!sp2) { started = false; continue; }  // vertex behind camera: break the path
          if (!started) { fxCtx.moveTo(sp2.x, sp2.y); started = true; }
          else fxCtx.lineTo(sp2.x, sp2.y);
          drew = true;
        }
        return drew;
      };
      if (traceHull(frac)) {
        fxCtx.strokeStyle = 'rgba(150,215,255,' + ((1 - k) * 0.7 * vv).toFixed(3) + ')';
        fxCtx.lineWidth = Math.max(1.2, 3.0 * pxPerM * (1 - k) + 1);
        fxCtx.stroke();
      }
      if (traceHull(frac * 0.55)) {
        fxCtx.strokeStyle = 'rgba(95,165,255,' + ((1 - k) * 0.4 * vv).toFixed(3) + ')';
        fxCtx.lineWidth = Math.max(1, 2.2 * pxPerM * (1 - k) + 0.8);
        fxCtx.stroke();
      }
      fxCtx.globalCompositeOperation = 'source-over';
      continue;
    }
    if (p.kind === 3) {
      const frac = Math.min(1, k * 2.2);            // expands to full radius fast
      // viewPos, NOT camPos: the orbit rotates the render view only, and the
      // v7.1 invariant is that the GPU and this 2D overlay consume the SAME
      // view or the two drift apart. camPos here was a leftover from the
      // single-file build, where it happens to be a global — in the modular
      // build fx.js never imported it, so this line threw ReferenceError and
      // killed the frame loop on the first bomb that reached the ground.
      const dx = p.x - viewPos[0], dy = p.y - viewPos[1], dz = p.z - viewPos[2];
      const dist = Math.max(20, Math.hypot(dx, dy, dz));
      const pxPerM = H / (2 * dist * TAN_HALF_FOV); // world→screen at blast depth
      const traceRing = (fr) => {
        let started = false, drew = false;
        fxCtx.beginPath();
        for (let v = 0; v <= RING_N; v++) {
          const vi = v % RING_N;
          const a = (vi / RING_N) * 6.28318;
          const wx = p.x + Math.cos(a) * (p.R || BLAST_R) * fr;
          const wz = p.z + Math.sin(a) * (p.R || BLAST_R) * fr;
          const wy = p.y + (p.ringH[vi] - p.y) * fr; // lerp center→sampled rim height
          const s = projectFx(camB, wx, wy, wz, W, H);
          if (!s) { started = false; continue; }     // vertex behind camera: break path
          if (!started) { fxCtx.moveTo(s.x, s.y); started = true; }
          else fxCtx.lineTo(s.x, s.y);
          drew = true;
        }
        return drew;
      };
      fxCtx.globalCompositeOperation = 'lighter';
      if (k < 0.22) {                                // initial flash at ground zero
        const c = projectFx(camB, p.x, p.y, p.z, W, H);
        if (c) {
          fxCtx.beginPath();
          fxCtx.arc(c.x, c.y, Math.max(2, 10 * pxPerM * (1 - k * 4.5) + 2), 0, 6.2832);
          fxCtx.fillStyle = 'rgba(255,230,170,' + Math.max(0, 0.85 * (1 - k * 4.5) * vv).toFixed(3) + ')';
          fxCtx.fill();
        }
      }
      if (traceRing(frac)) {                         // fire ring on the ground
        fxCtx.strokeStyle = 'rgba(255,170,90,' + ((1 - k) * 0.8 * vv).toFixed(3) + ')';
        fxCtx.lineWidth = Math.max(1.2, 4 * pxPerM * (1 - k) + 1);
        fxCtx.stroke();
      }
      fxCtx.globalCompositeOperation = 'source-over';
      if (traceRing(frac * 0.78)) {                  // trailing smoke ring
        fxCtx.strokeStyle = 'rgba(120,110,100,' + ((1 - k) * 0.4 * vv).toFixed(3) + ')';
        fxCtx.lineWidth = Math.max(1, 2.5 * pxPerM * (1 - k) + 0.8);
        fxCtx.stroke();
      }
      continue;
    }
    const s = projectFx(camB, p.x, p.y, p.z, W, H);
    if (!s) continue;
    const r = (2 + k * 18) * (60 / Math.min(s.z, 300));
    fxCtx.beginPath();
    fxCtx.arc(s.x, s.y, Math.max(1.5, r), 0, 6.2832);
    fxCtx.strokeStyle = (p.kind === 2 ? 'rgba(190,225,255,' : 'rgba(212,192,152,') + ((1 - k) * 0.75 * vv).toFixed(3) + ')';
    fxCtx.lineWidth = 2 * (1 - k) + 0.6;
    fxCtx.stroke();
  }
  // harvest pops: soft expanding cyan rings (matches the alien blue flora)
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    const age = (now - p.t0) / 1000;
    if (age < 0) continue;   // staggered blast pop not started yet
    if (age > POP_LIFE) { pops.splice(i, 1); continue; }
    const s = projectFx(camB, p.x, p.y, p.z, W, H);
    if (!s) continue;
    const k = age / POP_LIFE;
    const vv = fxVis(p);
    if (vv < 0.02) continue;
    const r = (4 + k * 46) * (60 / Math.min(s.z, 200));
    fxCtx.beginPath();
    fxCtx.arc(s.x, s.y, Math.max(2, r), 0, 6.2832);
    fxCtx.strokeStyle = 'rgba(130,215,255,' + ((1 - k) * 0.8 * vv).toFixed(3) + ')';
    fxCtx.lineWidth = 2.5 * (1 - k) + 0.5;
    fxCtx.stroke();
  }
  for (let i = trail.length - 1; i >= 0; i--) {
    const p = trail[i];
    const age = (now - p.t0) / 1000;
    if (age > TRAIL_LIFE) { trail.splice(i, 1); continue; }
    const s = projectFx(camB, p.x, p.y, p.z, W, H);
    if (!s) continue;
    const sx = s.x, sy = s.y;
    if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
    const k = 1 - age / TRAIL_LIFE;
    const vv = fxVis(p);
    if (vv < 0.02) continue;
    const r = (2.0 + age * 4.8) * (60 / s.z) * (p.boost ? 1.6 : 1.0);   // v7.4: doubled
    fxCtx.beginPath();
    fxCtx.arc(sx, sy, Math.max(1.2, Math.min(r, 52)), 0, 6.2832);
    fxCtx.fillStyle = 'rgba(255,255,255,' + (k * k * (p.boost ? 0.34 : 0.16) * vv).toFixed(3) + ')';
    fxCtx.fill();
  }
}
