// Hull see-through census — NOT a test suite. Run it directly:
//     node test/hull_census.js
//
// Answers one question with numbers: when a hull looks transparent, is that
// REAL fractal geometry or the marcher running out of iterations? Those need
// opposite responses — collision should follow real holes, and must not be
// taught to follow a marcher artifact.
//
// It replicates marchAliens' hull march exactly as shaders.js writes it, in
// fp32 (Math.fround) so iteration counts match the GPU, and classifies every
// ray that enters a hull's bounding box:
//
//   HIT          found surface
//   see-through  crossed the whole box without ever nearing the surface,
//                i.e. the mandelbox genuinely has nothing there
//   budget       ran out of iterations, so the hull was not drawn — the
//                "budget exhaustion must be a HIT, never a hole" class
//
// Measured 19 Sept 2026 at the shipped tuning: budget exhaustion is 0.00% in
// every configuration tried (max 177 iterations against a 384 cap), and
// see-through is 3.8% of the mothership / 8.7% of a harvester. `box fold` is
// the lever, NOT `box min r`: at fold 1.0 the hull becomes 57-64% holes, while
// minR moves it by less than a tenth of a percent.
const f = Math.fround;
let P = { scale: 3, minR2: 0.01, fold: 1.4 };     // uBoxParam.xyz
let BOXROUND = 0.45;

function mandelboxDE(px, py, pz, minR2) {
  let qx = px, qy = py, qz = pz, dr = 1.0;
  const fixR2 = 1.0, F = P.fold, S = P.scale;
  for (let i = 0; i < 8; i++) {
    qx = f(Math.min(Math.max(qx, -F), F) * 2 - qx);
    qy = f(Math.min(Math.max(qy, -F), F) * 2 - qy);
    qz = f(Math.min(Math.max(qz, -F), F) * 2 - qz);
    const r2 = f(qx * qx + qy * qy + qz * qz);
    if (r2 < minR2) { const k = f(fixR2 / minR2); qx = f(qx*k); qy = f(qy*k); qz = f(qz*k); dr = f(dr*k); }
    else if (r2 < fixR2) { const k = f(fixR2 / r2); qx = f(qx*k); qy = f(qy*k); qz = f(qz*k); dr = f(dr*k); }
    qx = f(qx * S + px); qy = f(qy * S + py); qz = f(qz * S + pz);
    dr = f(dr * Math.abs(S) + 1);
  }
  return f(Math.hypot(qx, qy, qz) / Math.abs(dr));
}
const sdBox = (lx, ly, lz, hx, hy, hz) => {
  const ax = Math.abs(lx) - hx, ay = Math.abs(ly) - hy, az = Math.abs(lz) - hz;
  return f(Math.hypot(Math.max(ax,0), Math.max(ay,0), Math.max(az,0)) + Math.min(Math.max(ax, Math.max(ay, az)), 0));
};
function shipDE(lx, ly, lz, h, minR2) {
  const hmin = Math.min(h[0], Math.min(h[1], h[2]));
  const mb = f(mandelboxDE(f(lx/h[0]*1.15), f(ly/h[1]*1.15), f(lz/h[2]*1.15), minR2) / 1.15 * hmin);
  const r = Math.min(BOXROUND * hmin, hmin * 0.98);
  return Math.max(sdBox(lx, ly, lz, h[0]-r, h[1]-r, h[2]-r) - r, mb);
}
function boxGate(lo, ld, h) {
  let tn = -1e18, tf = 1e18;
  for (let i = 0; i < 3; i++) {
    const inv = 1/(ld[i] + 1e-8);
    let a = (-h[i]-lo[i])*inv, b = (h[i]-lo[i])*inv;
    if (a > b) { const t=a; a=b; b=t; }
    tn = Math.max(tn, a); tf = Math.min(tf, b);
  }
  return [tn, tf];
}
// march one ray exactly as the shader does; returns iterations used, or -1 on miss
function march(ro, rd, c, h, minR2, CAP) {
  const lo = [ro[0]-c[0], ro[1]-c[1], ro[2]-c[2]];
  const g = boxGate(lo, rd, [h[0]+2, h[1]+2, h[2]+2]);
  if (!(g[0] < g[1] && g[1] > 0)) return { hit: false, it: 0, gated: false };
  let t = Math.max(g[0], 0);
  for (let i = 0; i < CAP; i++) {
    const d = shipDE(lo[0]+rd[0]*t, lo[1]+rd[1]*t, lo[2]+rd[2]*t, h, minR2);
    if (d < 0.5 + t*0.001) return { hit: true, it: i, gated: true };
    t += d;
    if (t > g[1]) return { hit: false, it: i, gated: true };     // exited the box: a real miss
  }
  return { hit: false, it: CAP, gated: true, exhausted: true };   // BUDGET -> drawn as a hole
}

// Cast rays from many directions at a hull and classify every ray that enters
// the bounding box: HIT (found surface), REAL hole (crossed the whole box with
// nothing in it), BUDGET hole (ran out of iterations).
function survey(half, scale, fold, minR, CAP) {
  P.scale = scale; P.fold = fold; P.minR2 = minR * minR;
  const c = [0, 0, 0];
  let gated = 0, hit = 0, real = 0, exh = 0, itMax = 0;
  const R = Math.hypot(half[0], half[1], half[2]);
  const N = 46;
  for (const [az, el, dist] of [[0,0,1.4],[0.7,0.15,1.4],[1.57,0,1.4],[0.4,0.9,1.6],[2.3,-0.5,2.2],[0.9,0.35,4.0]]) {
    const ro = [Math.sin(az)*Math.cos(el)*R*dist, Math.sin(el)*R*dist, Math.cos(az)*Math.cos(el)*R*dist];
    // aim at the centre, spread a grid across the hull's angular size
    const fwd = [-ro[0], -ro[1], -ro[2]]; const FL = Math.hypot(...fwd);
    for (let i=0;i<3;i++) fwd[i] /= FL;
    const up0 = [0,1,0];
    const rt = [fwd[1]*up0[2]-fwd[2]*up0[1], fwd[2]*up0[0]-fwd[0]*up0[2], fwd[0]*up0[1]-fwd[1]*up0[0]];
    const RL = Math.hypot(...rt); for (let i=0;i<3;i++) rt[i] /= RL;
    const up = [rt[1]*fwd[2]-rt[2]*fwd[1], rt[2]*fwd[0]-rt[0]*fwd[2], rt[0]*fwd[1]-rt[1]*fwd[0]];
    const spread = R / FL * 1.25;
    for (let yy=0; yy<N; yy++) for (let xx=0; xx<N; xx++) {
      const a = ((xx+0.5)/N*2-1)*spread, b = ((yy+0.5)/N*2-1)*spread;
      const d = [fwd[0]+rt[0]*a+up[0]*b, fwd[1]+rt[1]*a+up[1]*b, fwd[2]+rt[2]*a+up[2]*b];
      const L = Math.hypot(...d); const rd = [d[0]/L, d[1]/L, d[2]/L];
      const r = march(ro, rd, c, half, P.minR2, CAP);
      if (!r.gated) continue;
      gated++; if (r.it > itMax) itMax = r.it;
      if (r.exhausted) exh++; else if (r.hit) hit++; else real++;
    }
  }
  return { gated, hit, real, exh, itMax,
           pctReal: +(100*real/Math.max(gated,1)).toFixed(1),
           pctExh: +(100*exh/Math.max(gated,1)).toFixed(2) };
}
const pad = (v,n) => String(v).padStart(n);
// Hull sizes and the fractal defaults come from the LIVE knob table, so this
// measures the shipped ships rather than a snapshot of them (same reasoning as
// test/slope_census.js reading TUNE).
const { loadModule } = require('./harness');
const { TUNEA } = loadModule('tune.js');
BOXROUND = TUNEA.boxRound.v;
const MO = [TUNEA.moWid.v / 2, TUNEA.moHei.v / 2, TUNEA.moLen.v / 2];
const HV = [TUNEA.shLen.v / 2, TUNEA.shHei.v / 2, TUNEA.shWid.v / 2];
const D = { scale: TUNEA.boxScale.v, fold: TUNEA.boxFold.v, minR: TUNEA.boxMinR.v };
console.log('shipped tuning: box scale ' + D.scale + ', fold ' + D.fold +
            ', min r ' + D.minR + ', corners ' + BOXROUND);
console.log('mothership half ' + MO.join('/') + ' m, harvester half ' + HV.join('/') + ' m');
console.log('Rays that ENTER a hull bounding box, classified. 6 viewpoints x 46x46 rays.');
console.log('');
console.log('  hull  scale  fold  minR     rays   see-through%    budget%   maxIt');
for (const [name, half] of [['moth', MO], ['harv', HV]]) {
  for (const scale of [D.scale, 2.4, -2]) {
    for (const fold of [D.fold, 1.0]) {
      for (const minR of [0.5, D.minR, 0.05]) {
        const s = survey(half, scale, fold, minR, 384);
        console.log('  ' + pad(name,4) + pad(scale,7) + pad(fold,6) + pad(minR,6) +
                    pad(s.gated,9) + pad(s.pctReal,14) + pad(s.pctExh,10) + pad(s.itMax,8));
      }
    }
  }
}
