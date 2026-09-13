// THE SLOPE CENSUS — run this after ANY change to the terrain.
//
//     node test/slope_census.js
//
// The terrain march steps a fraction of the VERTICAL gap between the ray and
// the heightfield. That fraction is only safe up to a slope: the nearest rock
// to a point `g` above a face of angle θ is `g·cos θ` away, so
//
//     safe relaxation = cos(θ) = 1 / sqrt(1 + L²),   L = |∇h|
//
// Step further than that and a ray can pass THROUGH a ridge without ever
// sampling inside it. That was "the peaks breathe", for months.
// **docs/MARCHING.md** is the write-up; this is the measurement under it, kept
// runnable so the next person re-derives the numbers instead of trusting them.
//
// `test/test_march.js` asserts the headline numbers on every suite run. Use
// this tool when you want to see WHY, or before adding a term to the terrain.

const { loadModule } = require('./harness');

const { TUNE, TUNED } = loadModule('tune.js');
const M = loadModule('terrain.js', { TUNE }, ['noiseJ', 'mandelDEJ', 'smaxJ', 'fbmJ', 'ridgedJ']);
const { terrainShapeJ, mandelDEJ, smaxJ, fbmJ, ridgedJ } = M;

const sstep = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const deg = L => Math.atan(L) * 180 / Math.PI;
const safeRelax = L => 1 / Math.sqrt(1 + L * L);
const slopeFor = relax => Math.sqrt(1 / (relax * relax) - 1);

// terrainShapeJ with any factor FROZEN at its value at the probe centre, so a
// gradient can be attributed to one field instead of the product. Frozen
// nothing, it is terrainShapeJ line for line (asserted in main below).
function shapeF(px, pz, F = {}) {
  const w1 = mandelDEJ(px * 2.5e-4 - 0.55, pz * 2.5e-4) / 2.5e-4;
  const w2 = mandelDEJ(px * 1e-4 - 0.55, (pz - 14000) * 1e-4) / 1e-4;
  const wde = Math.min(w1, w2);
  const mass = F.mass !== undefined ? F.mass : Math.exp(-wde * TUNE.massDecay.v);
  const base = fbmJ(px * 0.0004, pz * 0.0004, 3) * 70 + 4 - Math.min(wde * TUNE.oceanSlope.v, TUNE.oceanMax.v);
  const qx = fbmJ(px * 0.0009, pz * 0.0009, 3), qy = fbmJ(px * 0.0009 + 5.2, pz * 0.0009 + 1.3, 3);
  const wx = px + qx * 60, wz = pz + qy * 60;
  const th = 17.3 / (TUNE.snowyPct.v / 100 + 6.44) - 2.32;
  const tt = F.tall !== undefined ? F.tall : sstep(th - 0.05, th + 0.05, fbmJ(px * 0.00018, pz * 0.00018, 2));
  const ridge = F.ridge !== undefined ? F.ridge : ridgedJ(wx * 0.0016, wz * 0.0016, 5);
  let m = (80 + TUNE.mountAmp.v * ridge) * mass * (0.42 + 0.68 * tt);
  m = 460 * Math.tanh(m / 460) - 70 * (1 - mass);
  const hh = smaxJ(base, m, 45);
  const lake = F.lake !== undefined ? F.lake
    : sstep(0.58, 0.72, fbmJ(px * 0.0003 + 200, pz * 0.0003 + 200, 3)) * sstep(0.4, 0.9, mass) * (1 - sstep(30, 80, m));
  return hh * (1 - lake * 0.65) + (-15) * lake * 0.65;
}
const frozenAt = (x, z) => {
  const w1 = mandelDEJ(x * 2.5e-4 - 0.55, z * 2.5e-4) / 2.5e-4, w2 = mandelDEJ(x * 1e-4 - 0.55, (z - 14000) * 1e-4) / 1e-4;
  const wde = Math.min(w1, w2), mass = Math.exp(-wde * TUNE.massDecay.v);
  const qx = fbmJ(x * 0.0009, z * 0.0009, 3), qy = fbmJ(x * 0.0009 + 5.2, z * 0.0009 + 1.3, 3);
  const th = 17.3 / (TUNE.snowyPct.v / 100 + 6.44) - 2.32;
  return { mass, ridge: ridgedJ((x + qx * 60) * 0.0016, (z + qy * 60) * 0.0016, 5),
           tall: sstep(th - 0.05, th + 0.05, fbmJ(x * 0.00018, z * 0.00018, 2)) };
};
function gradF(x, z, e = 0.5, F = {}) {
  return Math.hypot((shapeF(x + e, z, F) - shapeF(x - e, z, F)) / (2 * e),
                    (shapeF(x, z + e, F) - shapeF(x, z - e, F)) / (2 * e));
}
// |grad wde|: a true distance function is 1-Lipschitz. This one is not.
function gradWde(x, z, e = 0.5) {
  const w = (a, b) => Math.min(mandelDEJ(a * 2.5e-4 - 0.55, b * 2.5e-4) / 2.5e-4, mandelDEJ(a * 1e-4 - 0.55, (b - 14000) * 1e-4) / 1e-4);
  return Math.hypot((w(x + e, z) - w(x - e, z)) / (2 * e), (w(x, z + e) - w(x, z - e)) / (2 * e));
}

// A deterministic land grid. NEVER random: the answer has to be comparable
// between runs, or it is not a guard.
function landGrid(step) {
  const pts = [];
  for (let x = -2000; x < 9000; x += step) for (let z = -2000; z < 9000; z += step) if (terrainShapeJ(x, z) > 5) pts.push([x, z]);
  return pts;
}
function slopes(pts, e = 0.5, F = {}) {
  const g = pts.map(([x, z]) => gradF(x, z, e, F)).sort((a, b) => a - b);
  const q = p => g[Math.min(g.length - 1, Math.floor(p * g.length))];
  return { g, q, max: g[g.length - 1], overFrac: relax => g.filter(v => v > slopeFor(relax)).length / g.length };
}

module.exports = { shapeF, frozenAt, gradF, gradWde, landGrid, slopes, safeRelax, slopeFor, deg };

if (require.main === module) {
  let worst = 0;
  for (let i = 0; i < 300; i++) { const x = 1000 + i * 13.7, z = 3000 + i * 7.1; worst = Math.max(worst, Math.abs(shapeF(x, z) - terrainShapeJ(x, z))); }
  console.log('replica vs terrainShapeJ (nothing frozen): max |diff| ' + worst.toExponential(1) + ' m\n');
  const t0 = Date.now();

  console.log('(1) THE MAX SLOPE DOES NOT CONVERGE. It is a fractal surface: look harder, find steeper.');
  console.log('    grid step   land points   max slope   the relax it would demand');
  for (const step of [200, 100, 50, 30]) {
    const pts = landGrid(step), s = slopes(pts);
    console.log('    ' + String(step).padStart(8) + ' m   ' + String(pts.length).padStart(11) + '   ' +
                deg(s.max).toFixed(1).padStart(6) + '°       ' + safeRelax(s.max).toFixed(3));
  }
  console.log('    -> a MEASURED max is a lower bound, never a guarantee. Use a percentile and');
  console.log('       make the tail cheap, or bound the gradient at construction (docs/MARCHING.md R2).');

  const pts = landGrid(30), s = slopes(pts);
  console.log('\n(2) THE SHIPPED WORLD  (' + pts.length + ' land points, 30 m grid, gradient at 0.5 m)');
  console.log('    median ' + deg(s.q(0.5)).toFixed(1) + '°   p90 ' + deg(s.q(0.9)).toFixed(1) + '°   p99 ' + deg(s.q(0.99)).toFixed(1) +
              '°   p99.9 ' + deg(s.q(0.999)).toFixed(1) + '°   max ' + deg(s.max).toFixed(1) + '°');
  console.log('    relax    safe up to   land it cannot step safely');
  for (const r of [0.55, 0.45, 0.35, 0.30, 0.25, 0.20]) {
    const mark = r === TUNED.relaxMtn.d ? '  <- default' : (r === TUNED.relaxMtn.min ? '  <- slider min' : '');
    console.log('    ' + r.toFixed(2).padStart(5) + '      ' + deg(slopeFor(r)).toFixed(1).padStart(5) + '°      ' +
                (100 * s.overFrac(r)).toFixed(3).padStart(7) + '%' + mark);
  }

  console.log('\n(3) WHOSE SLOPE IS IT? One factor frozen at a time, at the ten steepest points.');
  const steep = pts.map(([x, z]) => [gradF(x, z), x, z]).sort((a, b) => b[0] - a[0]).slice(0, 10);
  console.log('        x      z   as shipped   mass frozen   ridge frozen   tall frozen');
  for (const [g, x, z] of steep) {
    const v = frozenAt(x, z);
    console.log('    ' + String(x).padStart(5) + '  ' + String(z).padStart(5) + '    ' + deg(g).toFixed(1).padStart(6) + '°      ' +
                deg(gradF(x, z, 0.5, { mass: v.mass })).toFixed(1).padStart(6) + '°       ' +
                deg(gradF(x, z, 0.5, { ridge: v.ridge })).toFixed(1).padStart(6) + '°       ' +
                deg(gradF(x, z, 0.5, { tall: v.tall })).toFixed(1).padStart(6) + '°');
  }

  console.log('\n(4) WHY `mass` IS THE WORST OFFENDER. mass = exp(-wde * ' + TUNE.massDecay.v + '), and wde is a');
  console.log('    Mandelbrot DISTANCE ESTIMATE — which is not a distance, and not 1-Lipschitz.');
  const gw = pts.map(([x, z]) => gradWde(x, z)).sort((a, b) => a - b);
  const qw = p => gw[Math.min(gw.length - 1, Math.floor(p * gw.length))];
  console.log('    |grad wde|:  median ' + qw(0.5).toFixed(2) + '   p99 ' + qw(0.99).toFixed(2) + '   p99.9 ' + qw(0.999).toFixed(2) +
              '   MAX ' + gw[gw.length - 1].toFixed(1) + '   (a true distance would be 1.00 everywhere)');
  const amp = TUNE.mountAmp.v * TUNE.massDecay.v;
  console.log('    it reaches the terrain as ' + TUNE.mountAmp.v + ' m * ' + TUNE.massDecay.v + ' * mass * |grad wde| = ' + amp.toFixed(3) + ' * mass * |grad wde|:');
  for (const v of [1, qw(0.99), gw[gw.length - 1]]) console.log('      |grad wde| = ' + v.toFixed(2).padStart(5) + '  ->  ' + deg(amp * v).toFixed(1).padStart(5) + '° of ground');
  console.log('    fraction of land with |grad wde| > 1.5: ' + (100 * gw.filter(v => v > 1.5).length / gw.length).toFixed(2) +
              '%,  > 3: ' + (100 * gw.filter(v => v > 3).length / gw.length).toFixed(2) + '%');
  console.log('    A THIN SET — which is why the glitch was always "certain ridges, certain spots".');

  console.log('\n' + ((Date.now() - t0) / 1000).toFixed(1) + ' s.  docs/MARCHING.md says what to do with these numbers.');
}
