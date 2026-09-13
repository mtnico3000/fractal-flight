// The march-vs-terrain contract. The one guard that would have prevented six
// weeks of "the peaks breathe".
//
// The terrain march steps `relax × the vertical gap`. That is a safe step only
// where the ground is no steeper than `acos(relax)` -- steeper than that, a ray
// can cross a ridge without ever sampling inside it, and whether it does
// depends on where the camera happens to be standing. So the marcher and the
// terrain are not independent: **steepening the world breaks the marcher**, and
// nothing else in the suite can see that happen.
//
// These assertions are cheap statistics over the shipped terrain. If one goes
// red after a terrain edit, the world got steeper: run `node
// test/slope_census.js`, read docs/MARCHING.md, and either lower the
// relaxation (and pay for it in every frame) or bound the new term's gradient.

const { loadModule, check, eq, ok, summary } = require('./harness');
const { landGrid, slopes, gradWde, safeRelax, slopeFor, deg } = require('./slope_census');

const { TUNED } = loadModule('tune.js');

console.log('march');

check('the safe-step formula is cos(slope), not 1/tan(slope)', () => {
  // The nearest point of a plane of slope θ to a point `g` vertically above the
  // surface is `g·cos θ` away. Recorded because the first write-up of this had
  // it as 1/tan(θ), which agrees to 6% at 70° and to 14% at 56° -- close enough
  // to look right and wrong enough to ship an unsafe step.
  for (const [slopeDeg, want] of [[0, 1], [45, 0.7071], [56.6, 0.5504], [69.5, 0.3502], [75.5, 0.2504]]) {
    const L = Math.tan(slopeDeg * Math.PI / 180);
    ok(Math.abs(safeRelax(L) - want) < 5e-4, 'cos(' + slopeDeg + '°) should be ' + want + ', got ' + safeRelax(L).toFixed(4));
  }
  ok(Math.abs(deg(slopeFor(0.55)) - 56.6) < 0.1, 'relax 0.55 must invert to 56.6°');
});

// One deterministic grid, shared by the rest. 100 m over the island: ~10k land
// points, well under a second. The MAX slope of a fractal surface does not
// converge (see slope_census (1)), so every assertion below is on a percentile.
const pts = landGrid(100);
const s = slopes(pts);

check('the shipped terrain is no steeper than when the relaxation was chosen', () => {
  ok(pts.length > 8000, 'expected ~10k land points on a 100 m grid, got ' + pts.length);
  // Measured 13 Sept 2026. Bands are wide enough for retuning, tight enough
  // that a new terrain TERM moves them.
  const p99 = deg(s.q(0.99)), p999 = deg(s.q(0.999));
  ok(p99 > 55 && p99 < 68, 'p99 slope is ' + p99.toFixed(1) + '°, was 61.4° -- the world changed shape');
  ok(p999 > 62 && p999 < 75, 'p99.9 slope is ' + p999.toFixed(1) + '°, was 68.0° -- the world changed shape');
});

check('the relaxation slider can still reach a safe step for this terrain', () => {
  // The fix has to be REACHABLE. If a terrain edit pushes the p99.99 past what
  // the slider can cover, the glitch is back and no setting can remove it.
  const tail = deg(s.q(0.9999));
  const need = safeRelax(s.q(0.9999));
  ok(TUNED.relaxMtn.min <= need + 1e-9,
     'the p99.99 slope is ' + tail.toFixed(1) + '°, which needs relax <= ' + need.toFixed(3) +
     ', but the slider stops at ' + TUNED.relaxMtn.min + ' -- extend its range or bound the terrain gradient');
});

check('the default relaxation leaves only the known thin tail unmarchable', () => {
  // 13 Sept 2026: 0.55 cannot step safely on 2.6% of the island, which is
  // exactly the "certain ridges" Nico kept finding. This assertion is not a
  // demand that the default be SAFE -- that is a live decision about frame
  // cost (ROADMAP) -- it is a demand that the number stay KNOWN.
  const bad = 100 * s.overFrac(TUNED.relaxMtn.d);
  ok(bad < 6, 'relax ' + TUNED.relaxMtn.d + ' cannot step safely on ' + bad.toFixed(2) +
     '% of the island (was 2.6%); a terrain term made the world steeper');
  eq(TUNED.relaxMtn.max, 0.55, 'the slider top must stay at the v9.5 behaviour, for A/B');
});

check('the Mandelbrot mass field is still the gradient outlier it was measured to be', () => {
  // mass = exp(-wde·massDecay) multiplies a 460 m amplitude, so |∇wde| lands on
  // the terrain magnified ~0.5 m per metre. wde is a distance ESTIMATE: a true
  // distance is 1-Lipschitz, this one reaches 20+ on a thin set. If that set
  // grows, the steep tail grows with it.
  const g = pts.map(([x, z]) => gradWde(x, z)).sort((a, b) => a - b);
  const med = g[Math.floor(0.5 * g.length)];
  const frac = 100 * g.filter(v => v > 1.5).length / g.length;
  ok(med > 0.4 && med < 0.9, '|grad wde| median is ' + med.toFixed(2) + ', was 0.64');
  ok(frac < 3, '|grad wde| exceeds 1.5 on ' + frac.toFixed(2) + '% of land (was 0.8%) -- the steep tail is spreading');
});

process.exitCode = summary('march') ? 1 : 0;
