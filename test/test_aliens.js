// Alien invasion regression tests — promoted from the console probes used to
// diagnose the 6 Sept 2026 "game freezes when a ship goes down" report.
//
// Two behaviours are pinned here:
//
//  1. Bomb counts. alienBombHits() does a plain hp-- and consumes the bomb,
//     with no splash, so HP_* IS the number of direct hits to down a hull.
//     Those numbers are Nico's, and the constants were previously written
//     twice each (spawn site + initAliens reset) where they could drift.
//
//  2. A downed hull is INERT. It must stop taking bomb hits AND stop crashing
//     the player. Before the fix only the bomb path checked, so the wreck you
//     had just shot down killed you on its way past — you are by definition
//     right beside it — and its melting hull left an invisible killbox at
//     ground level for the 8 s it took to sink.

const { loadModule, check, eq, ok, summary } = require('./harness');

const GROUND = 30;   // flat stub terrain: inside the 8..60 m "plains" band

function fresh() {
  const { TUNEA } = loadModule('tune.js');
  // the real constant, not a copy -- config.js has no imports of its own
  const { HULL_BLAST_R } = loadModule('config.js');
  const craft = { pos: [1e6, 1e6, 1e6] };   // far from everything by default
  const crashes = [];
  const blasts = [];
  const counts = { harv: -1, relays: -1, mothers: -1 };
  const paid = [];                          // every addEnergy the fleet triggers
  const aliens = loadModule('aliens.js', {
    TUNEA,
    DBG: { invasion: 1 },
    HULL_BLAST_R,
    craft,
    terrainShapeJ: () => GROUND,
    collectedSet: new Set(),
    bombs: [null, null, null],
    impacts: [],
    blastQueue: [],
    hullExplosionSound: () => {},
    addEnergy: (n) => { paid.push(n); },
    zapSound: () => {},
    relayBlastSound: () => { blasts.push(1); },
    doCrash: (why) => crashes.push(why),
    // the HUD tally: captured so the counts can be asserted, not just stubbed
    setFleetCounts: (h, r, m) => { counts.harv = h; counts.relays = r; counts.mothers = m; },
    resetFleetCounts: () => {},
  }, ['HP_MOTHER', 'HP_SHIP', 'HP_RELAY', 'hullAlive', 'bombs', 'craft',
      'boxFace', 'sphereFace', 'HULL_BLAST_R', 'RELAY_GROW', 'RELAY_SHOTS',
      'RELAY_SHRINK_MS', 'hullDist', 'LASER_DAMAGE', 'spawnHarvester', 'SHIP_SEP']);
  aliens.initAliens();
  return { aliens, craft, crashes, blasts, counts, TUNEA, paid };
}

// Drop a bomb dead-centre in `target`, one per frame, until its hp runs out.
// Count on hp, NOT on `falling`: a harvester hovers 45..60 m up while its half
// height is 60 m, so fallAndMelt lands it in the very frame it dies — falling
// goes true then false again inside one updateAliens call and is never
// observable from outside. The mothership and relay sit high enough to
// actually fall. (Cost a red test before it was understood.)
function bombUntilDown(aliens, target, at, limit) {
  let n = 0;
  while (target.hp > 0 && n < limit) {
    aliens.bombs[0] = { x: at()[0], y: at()[1], z: at()[2], vx: 0, vy: 0, vz: 0, age: 5 };
    aliens.updateAliens(1 / 60, 1000 + n);
    n++;
  }
  return n;
}

console.log('aliens');

check('hp constants are the agreed bomb counts', () => {
  const { aliens } = fresh();
  eq(aliens.HP_MOTHER, 40, 'HP_MOTHER');
  eq(aliens.HP_SHIP, 20, 'HP_SHIP');
  eq(aliens.HP_RELAY, 6, 'HP_RELAY');
});

check('initAliens seeds every hull from those constants', () => {
  const { aliens } = fresh();
  eq(aliens.alien.mother.hp, aliens.HP_MOTHER, 'mother.hp');
  eq(aliens.alien.relay.hp, aliens.HP_RELAY, 'relay.hp');
  eq(aliens.alien.ships.length, 2, 'ships spawned');
  for (const s of aliens.alien.ships) eq(s.hp, aliens.HP_SHIP, 'ship.hp');
});

check('exactly HP_MOTHER bombs down the mothership', () => {
  const { aliens } = fresh();
  const m = aliens.alien.mother;
  const n = bombUntilDown(aliens, m, () => [m.x, m.y, m.z], 500);
  eq(n, aliens.HP_MOTHER, 'bombs needed');
  ok(!aliens.hullAlive(m), 'mothership is down');
});

check('exactly HP_SHIP bombs down a harvester', () => {
  const { aliens } = fresh();
  const s = aliens.alien.ships[0];
  const n = bombUntilDown(aliens, s, () => [s.x, s.y, s.z], 500);
  eq(n, aliens.HP_SHIP, 'bombs needed');
  ok(!aliens.hullAlive(s), 'harvester is down');
});

check('exactly HP_RELAY bombs down the relay', () => {
  const { aliens } = fresh();
  const r = aliens.alien.relay;
  const n = bombUntilDown(aliens, r, () => [r.x, r.y, r.z], 500);
  eq(n, aliens.HP_RELAY, 'bombs needed');
  ok(!aliens.hullAlive(r), 'relay is down');
});

check('a falling or melting hull takes no further bomb hits', () => {
  const { aliens } = fresh();
  const s = aliens.alien.ships[0];
  s.falling = true;
  const hpBefore = s.hp;
  aliens.bombs[0] = { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, age: 5 };
  aliens.updateAliens(1 / 60, 2000);
  eq(s.hp, hpBefore, 'hp unchanged while falling');
});

// --- the crash matrix: this is the bug that was reported ---------------------

// Park the craft inside `obj` and report whether THIS hull ended the flight.
//
// Every other hull is displaced first, and that is not tidiness. initAliens()
// drops TWO harvesters on independent random plains spots and the harvester
// box is 780 x 330 x 120 m, so about once in 150 runs the pair lands close
// enough (measured: gaps of 57..408 m) that the craft parked on ships[0] is
// also inside the still-live ships[1]. updateAliens() then calls doCrash for
// real -- from the neighbour, not from the hull under test -- and the "a
// downed hull is inert" assertions failed roughly 5% of the time with a
// legitimate ALIEN HULL. Isolating the subject is what all four assertions in
// the matrix below already mean to say.
function crashedAt(aliens, craft, crashes, obj) {
  const FAR = 1e6;
  const others = [aliens.alien.mother, aliens.alien.relay, ...aliens.alien.ships]
    .filter(h => h !== obj)
    .map(h => [h, h.x, h.y, h.z]);
  for (const [h] of others) { h.x += FAR; h.y += FAR; h.z += FAR; }

  crashes.length = 0;
  // Follow the hull for a few frames rather than testing a single one. A
  // melting hull SINKS, so one frame let it slide out from under a craft
  // parked at its pre-update position -- "a MELTING hull is inert" then
  // passed even with melt dropped from hullAlive entirely (verified
  // 9 Sept 2026). Re-parking each frame keeps the assertion about inertness
  // instead of about displacement.
  for (let i = 0; i < 8 && crashes.length === 0; i++) {
    craft.pos[0] = obj.x; craft.pos[1] = obj.y; craft.pos[2] = obj.z;
    aliens.updateAliens(1 / 60, 3000 + i);
  }

  for (const [h, x, y, z] of others) { h.x = x; h.y = y; h.z = z; }
  return crashes.length > 0;
}

check('a LIVE hull still ends the flight (regression guard)', () => {
  const { aliens, craft, crashes } = fresh();
  ok(crashedAt(aliens, craft, crashes, aliens.alien.ships[0]), 'live harvester is lethal');
  ok(crashedAt(aliens, craft, crashes, aliens.alien.mother), 'live mothership is lethal');
  ok(crashedAt(aliens, craft, crashes, aliens.alien.relay), 'live relay is lethal');
});

check('a FALLING hull is inert', () => {
  const { aliens, craft, crashes } = fresh();
  const s = aliens.alien.ships[0];
  s.falling = true;
  ok(!crashedAt(aliens, craft, crashes, s), 'falling harvester must not crash the player');
  const m = aliens.alien.mother;
  m.falling = true;
  ok(!crashedAt(aliens, craft, crashes, m), 'falling mothership must not crash the player');
});

check('a MELTING hull is inert', () => {
  const { aliens, craft, crashes } = fresh();
  const s = aliens.alien.ships[0];
  s.melt = 0.5;
  ok(!crashedAt(aliens, craft, crashes, s), 'melting harvester must not crash the player');
  const r = aliens.alien.relay;
  r.melt = 0.5;
  ok(!crashedAt(aliens, craft, crashes, r), 'melting relay must not crash the player');
});

check('hullAlive is the single predicate behind all of that', () => {
  const { aliens } = fresh();
  const h = aliens.hullAlive;
  ok(h({ melt: 0 }), 'a plain live hull is alive');
  ok(!h({ falling: true, melt: 0 }), 'falling is not alive');
  ok(!h({ melt: 1e-4 }), 'melting is not alive, even at the 1e-4 the melt starts at');
  ok(!h({ gone: true, melt: 0 }), 'gone is not alive');
});

// --- the bomb-hit ring frame ------------------------------------------------
// The ring is drawn ON the face that was struck, so fx.js needs an in-plane
// basis and a radius that fits. Getting the face wrong is not subtle -- the
// ring ends up hanging in the air beside the ship -- but it is easy to get
// wrong in a way that only shows on one of the three axes.
const dot3 = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

check('a hull hit picks the face it actually struck', () => {
  const { aliens, TUNEA } = fresh();
  const half = [TUNEA.shLen.v / 2, TUNEA.shHei.v / 2, TUNEA.shWid.v / 2];
  const ship = { x: 0, y: 100, z: 0, a: 0 };
  const cases = [
    ['top',   { x: 0, y: 100 + half[1] - 1, z: 0 }, 1],
    ['flank', { x: 0, y: 100, z: half[2] - 1 }, 2],
    ['nose',  { x: half[0] - 1, y: 100, z: 0 }, 0],
  ];
  for (const [what, B, axis] of cases) {
    const f = aliens.boxFace(B, ship, half, true);
    // the struck axis is the one pushed out to its half-extent, and it is the
    // one NEITHER in-plane vector spans
    ok(Math.abs(Math.abs(f.lp[axis]) - (half[axis] + 0.8)) < 1e-9,
       what + ': the ring should sit just proud of the face, got ' + f.lp[axis]);
    eq(f.u[axis], 0, what + ': u must lie in the face');
    eq(f.v[axis], 0, what + ': v must lie in the face');
    eq(dot3(f.u, f.v), 0, what + ': the in-plane axes must be perpendicular');
  }

  // The common case, and the one that decides HOW the face is chosen: a bomb
  // landing on the deck but well forward of centre. It is 300 m along a 1200 m
  // hull and only 59 m up a 120 m one -- so in METRES the length axis wins and
  // the ring gets drawn on the nose, hanging in the air beside the ship. In
  // half-extents the deck wins (0.98 vs 0.50), which is where it actually hit.
  const off = aliens.boxFace({ x: 300, y: 100 + half[1] - 1, z: 0 }, ship, half, true);
  eq(off.u[1], 0, 'an off-centre deck hit must still land on the deck, not the nose');
  eq(off.v[1], 0, 'an off-centre deck hit must still land on the deck, not the nose');
  ok(Math.abs(off.lp[1] - (half[1] + 0.8)) < 1e-9,
     'the ring should sit on the deck at y = ' + (half[1] + 0.8) + ', got ' + off.lp[1]);
});

check('the ring is clamped to the face it lies on', () => {
  const { aliens, TUNEA } = fresh();
  const R = aliens.HULL_BLAST_R;
  const ship = { x: 0, y: 100, z: 0, a: 0 };
  // Drive BOTH branches from synthetic hulls rather than leaning on the
  // shipped one. This assertion used to read "a flank is only 120 m tall, so
  // the ring must shrink" -- true only because shHei happened to be 120. When
  // it moved to 206 in v9.8b the flank became taller than the blast radius,
  // the ring correctly stopped shrinking, and the test went red with nothing
  // wrong. The tuning is not the invariant; the clamp is.
  const roomy = [600, R * 3, 400];
  const tight = [600, R * 0.5, 400];
  const top = aliens.boxFace({ x: 0, y: 100 + roomy[1] - 1, z: 0 }, ship, roomy, true);
  eq(top.maxR, R, 'a broad deck should get the full blast radius');
  const wide = aliens.boxFace({ x: 0, y: 100, z: roomy[2] - 1 }, ship, roomy, true);
  eq(wide.maxR, R, 'a flank taller than the blast radius must not shrink the ring');
  const narrow = aliens.boxFace({ x: 0, y: 100, z: tight[2] - 1 }, ship, tight, true);
  ok(narrow.maxR < R, 'a flank only ' + (tight[1] * 2) + ' m tall must shrink the ring: got ' + narrow.maxR);
  ok(narrow.maxR <= tight[1], 'the ring must not hang off the face: ' + narrow.maxR + ' > ' + tight[1]);
  // whatever the hull is tuned to, the ring must still sit on it
  const half = [TUNEA.shLen.v / 2, TUNEA.shHei.v / 2, TUNEA.shWid.v / 2];
  const live = aliens.boxFace({ x: 0, y: 100, z: half[2] - 1 }, ship, half, true);
  ok(live.maxR <= Math.min(R, half[1]) + 1e-9,
     'the shipped hull overhangs its own flank: ' + live.maxR + ' on a ' + half[1] + ' m half-height');
});

check('the relay gets a curved cap, not a flat disc', () => {
  const { aliens } = fresh();
  const relay = { x: 0, y: 500, z: 0, r: 15 };
  const f = aliens.sphereFace({ x: 0, y: 515, z: 0 }, relay, relay.r);
  eq(f.curv, relay.r, 'curvature must be the bulb radius (0 would draw it flat)');
  ok(Math.abs(Math.hypot(f.n[0], f.n[1], f.n[2]) - 1) < 1e-9, 'the normal must be unit length');
  ok(Math.abs(Math.hypot(f.u[0], f.u[1], f.u[2]) - 1) < 1e-9, 'u must be unit length');
  ok(Math.abs(dot3(f.n, f.u)) < 1e-9, 'u must be tangent to the surface');
  ok(Math.abs(dot3(f.u, f.v)) < 1e-9, 'u and v must be perpendicular');
  ok(f.maxR <= relay.r * 1.6 + 1e-9, 'the cap must not wrap past the far side');
});

// --- the HUD tally ----------------------------------------------------------
// It must count LIVE hulls. Counting objects instead would hold the numbers
// above zero for the ~116 s a wreck lingers, so INVADERS DEFEATED could never
// appear -- the banner is gated on all three reaching 0.
check('the fleet tally counts live hulls, not wrecks', () => {
  const { aliens, counts } = fresh();
  aliens.updateAliens(1 / 60, 1000);
  eq(counts.harv, 2, 'two harvesters at the start');
  eq(counts.relays, 1, 'one relay');
  eq(counts.mothers, 1, 'one mothership');

  // kill everything and let the wrecks linger
  aliens.alien.ships[0].falling = true;
  aliens.alien.ships[1].melt = 0.5;
  aliens.alien.relay.melt = 0.5;
  aliens.alien.mother.falling = true;
  aliens.updateAliens(1 / 60, 1100);
  eq(counts.harv, 0, 'a falling and a melting harvester are both dead');
  eq(counts.relays, 0, 'a melting relay is dead');
  eq(counts.mothers, 0, 'a falling mothership is dead');
  ok(aliens.alien.ships.length > 0,
     'and the wrecks are still PRESENT -- the tally is about liveness, not existence');
});

// --- rounded hulls: the shape you see is the shape you hit ---------------
// The hulls got a corner fillet in v9.4 (shipDE: sdBox(l, h - r) - r). The
// collision test is the SAME expression in JS, so a filleted corner is really
// empty air rather than an invisible solid block. Two properties matter: the
// fillet actually removes the corner, and r = 0 still behaves exactly like the
// plain axis-aligned box test the hulls used before it existed.
check('collision follows the rounded corners', () => {
  const { aliens, TUNEA } = fresh();
  const half = [600, 60, 400];          // a harvester at the default sizes
  const corner = [599, 59, 399];        // a hair inside the SHARP corner

  TUNEA.boxRound.v = 0;
  ok(aliens.hullDist(corner[0], corner[1], corner[2], half) < 0,
     'sharp hull: the corner must be solid');

  TUNEA.boxRound.v = 0.45;
  ok(aliens.hullDist(corner[0], corner[1], corner[2], half) > 0,
     'rounded hull: the corner has been filleted away, so it must be empty air');

  // the bulk of the hull is solid either way
  for (const round of [0, 0.45]) {
    TUNEA.boxRound.v = round;
    ok(aliens.hullDist(0, 0, 0, half) < 0, 'the middle is solid at round ' + round);
    ok(aliens.hullDist(0, 59, 0, half) < 0, 'the middle of a face is solid at round ' + round);
    ok(aliens.hullDist(601, 0, 0, half) > 0, 'just outside the long face is empty at round ' + round);
  }
});

check('a sharp hull collides exactly as it did before the fillet existed', () => {
  const { aliens, TUNEA } = fresh();
  TUNEA.boxRound.v = 0;
  const half = [600, 60, 400];
  for (const p of [[0, 0, 0], [599, 0, 0], [0, 59, 0], [0, 0, 399],
                   [601, 0, 0], [0, 61, 0], [0, 0, 401], [599, 59, 399]]) {
    const plainBox = Math.abs(p[0]) < half[0] && Math.abs(p[1]) < half[1] && Math.abs(p[2]) < half[2];
    eq(aliens.hullDist(p[0], p[1], p[2], half) < 0, plainBox,
       'r = 0 must match the plain box test at [' + p.join(', ') + ']');
  }
});

// --- the invasion economy's pacing ------------------------------------------
// Blast PACING must be independent of both relay SIZE and relay GROWTH. Two
// earlier versions coupled them and both went wrong: v9.3 tied the cadence to a
// hard-coded increment, and the first v9.4 attempt tied it to a size threshold,
// which made a 1%-per-shot growth need 600 shots and effectively never fire.
// The discharge is now on a shot count. Driven through the REAL updateAliens
// path, so re-coupling them shows up here.
check('blast pacing is a fixed shot count, whatever the size and growth knobs', () => {
  const { aliens, blasts, TUNEA } = fresh();
  const r = aliens.alien.relay;
  const base = r.baseR;
  const expect = aliens.RELAY_SHOTS;
  let n = 0;
  while (blasts.length === 0 && n < 4 * expect) {
    // one delivered energy shot per step: t0 far enough back to count as arrived
    aliens.alien.bolts.push({ x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0,
                              t0: 0, dur: 1, big: false, done: false, ship: null, src: 0 });
    aliens.updateAliens(1 / 60, 10000 + n);
    n++;
  }
  eq(n, expect, 'energy arrivals per discharge');
  // it must NOT snap back: the blast deflates it over RELAY_SHRINK_MS, with the
  // beam to the mothership lit for the same 2 s
  ok(r.r > base, 'the relay should still be swollen the instant it blasts, got ' + r.r);
  const bolt = aliens.alien.bolts[aliens.alien.bolts.length - 1];
  eq(bolt.big, true, 'the blast should fire a big bolt at the mothership');
  eq(bolt.dur, 2000, 'the bolt must last as long as the collapse, or the beam ends first');
  // run the clock past the collapse
  for (let i = 0; i < 60; i++) aliens.updateAliens(1 / 60, 10000 + 4 * expect + 50 * i);
  ok(Math.abs(r.r - base) < 1e-6, 'the relay should be back to base radius after the shrink, got ' + r.r);

  // and the cadence must not move when the growth knob does -- that coupling is
  // exactly what broke twice
  for (const g of [0, 0.005, 0.12]) {
    const f = fresh();
    f.TUNEA.relGrow.v = g;
    let k = 0;
    while (f.blasts.length === 0 && k < 4 * expect) {
      f.aliens.alien.bolts.push({ x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0,
                                  t0: 0, dur: 1, big: false, done: false, ship: null, src: 0 });
      f.aliens.updateAliens(1 / 60, 30000 + k);
      k++;
    }
    eq(k, expect, 'shots to discharge at relGrow = ' + g);
  }
});

// A wreck has to still be there when you circle back. v9.3 melted in 8 s flat,
// so the ship you had just bombed was gone before you came round.
check('a melted wreck stays visible for over a minute', () => {
  const { aliens } = fresh();
  const s = aliens.alien.ships[0];
  s.falling = false; s.melt = 1e-4;
  let t = 0;
  const step = 1 / 30;
  // the visible collapse should still be quick
  // 0.75 is below MELT_KNEE, so this measures the FAST phase only
  while (s.melt < 0.75 && t < 30) { aliens.updateAliens(step, 20000 + t * 1000); t += step; }
  ok(t < 12, 'the initial collapse should still take under ~12 s, took ' + t.toFixed(1));
  const tCollapse = t;
  while (s.melt < 1 && t < 400) { aliens.updateAliens(step, 20000 + t * 1000); t += step; }
  ok(t - tCollapse > 60,
     'the melted state must persist over a minute; it lasted only ' + (t - tCollapse).toFixed(0) + ' s');
  ok(!aliens.hullAlive(s), 'and it must stay inert for that whole time');
});

check('spent beams are retired instead of piling up', () => {
  const { aliens } = fresh();
  for (let i = 0; i < 30; i++) {
    aliens.alien.bolts.push({ x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0,
                              t0: 0, dur: 1, big: false, done: false, ship: null, src: 0 });
    aliens.updateAliens(1 / 60, 20000 + i);
  }
  ok(aliens.alien.bolts.length < 30,
     'alien.bolts must be pruned -- nothing else splices it now that the beams ' +
     'are drawn in the shader, so it would grow for the whole session (got ' +
     aliens.alien.bolts.length + ')');
});

check('one laser strike is worth six bombs, and melts the relay outright', () => {
  // The laser's whole point is that it kills what bombs chip at, and the
  // relay -- HP_RELAY = 6 -- is the shape of that promise: exactly one shot.
  // Pinned as the RATIO, not as "6", so re-tuning any hull's hp cannot
  // silently turn a one-shot into a two-shot.
  const { aliens } = fresh();
  eq(aliens.LASER_DAMAGE, 6, 'LASER_DAMAGE');
  eq(aliens.LASER_DAMAGE, aliens.HP_RELAY, 'one laser must take the relay from full hp to zero');

  const r = aliens.alien.relay;
  eq(r.hp, aliens.HP_RELAY, 'relay starts full');
  eq(aliens.alienLaserHit(7, r.x, r.y, r.z), true, 'the relay must accept the hit');
  ok(r.hp <= 0, 'relay survived a laser with ' + r.hp + ' hp');
  ok(r.falling, 'a relay at zero hp must go down');

  // and a second shot on the wreck does nothing: a downed hull is inert
  // everywhere else (hullAlive), and the laser must not be the exception
  eq(aliens.alienLaserHit(7, r.x, r.y, r.z), false, 'a falling relay must absorb nothing');
});

check('a laser needs six times fewer hits than a bomb on every hull', () => {
  const { aliens } = fresh();
  const m = aliens.alien.mother;
  let shots = 0;
  while (m.hp > 0 && shots < 50) { aliens.alienLaserHit(0, m.x, m.y, m.z); shots++; }
  eq(shots, Math.ceil(aliens.HP_MOTHER / aliens.LASER_DAMAGE), 'mothership shots');
  ok(m.falling, 'the mothership must go down when its hp runs out');

  const { aliens: a2 } = fresh();
  const s0 = a2.alien.ships[0];
  ok(s0, 'the fleet must start with a harvester to shoot at');
  let n = 0;
  while (s0.hp > 0 && n < 50) { a2.alienLaserHit(1, s0.x, s0.y, s0.z); n++; }
  eq(n, Math.ceil(a2.HP_SHIP / a2.LASER_DAMAGE), 'harvester shots');
});

check('an invader hands its gathered energy back when it starts melting', () => {
  // The payout is on the melt TRANSITION, which is the one moment all three
  // hull kinds pass through — that is why it lives in fallAndMelt and not in
  // three separate damage paths.
  const { aliens, paid } = fresh();
  const r = aliens.alien.relay;
  r.loot = 42;
  aliens.alienLaserHit(7, r.x, r.y, r.z);     // one shot melts it
  ok(r.falling, 'the relay should be on its way down');
  eq(paid.length, 0, 'nothing may be paid while it is still FALLING');

  for (let i = 0; i < 400 && !r.melt; i++) aliens.updateAliens(0.05, 1000 + i * 50);
  ok(r.melt > 0, 'the relay never reached the melt phase');
  eq(paid.length, 1, 'exactly one payout');
  eq(paid[0], 42, 'the plane gets what the hull had gathered');
  eq(r.loot, 0, 'the hull must not be able to pay twice');

  // and it stays paid out across the whole melt
  const before = paid.length;
  for (let i = 0; i < 100; i++) aliens.updateAliens(0.05, 40000 + i * 50);
  eq(paid.length, before, 'melting must not keep paying every frame');
});

check('a MELTING relay stops being fed', () => {
  // The economy guards were hand-rolled `!gone && !falling`, which omits the
  // melt term -- so harvesters went on shipping energy into a molten wreck,
  // and a bolt still in flight when it died banked into a hull that had
  // already paid its loot out. hullAlive is the predicate; nothing should
  // re-derive it.
  const { aliens } = fresh();
  const r = aliens.alien.relay;
  const s0 = aliens.alien.ships[0];
  ok(s0, 'need a harvester');

  // kill it and run until it is melting
  aliens.alienLaserHit(7, r.x, r.y, r.z);
  for (let i = 0; i < 400 && !r.melt; i++) aliens.updateAliens(0.05, 1000 + i * 50);
  ok(r.melt > 0, 'the relay never reached the melt phase');

  // a harvester with plenty banked must not fire at it any more
  const shots = aliens.alien.bolts.length;
  s0.absorbed = 30; s0.lastShot = 0;
  for (let i = 0; i < 40; i++) aliens.updateAliens(0.05, 60000 + i * 2000);
  eq(aliens.alien.bolts.length, shots, 'harvesters kept feeding a melting relay');
  eq(s0.absorbed, 30, 'and they must not spend their own stock doing it');

  // nor may a bolt already in the air bank into the wreck
  const loot = r.loot;
  aliens.alien.bolts.push({ x0: r.x, y0: r.y + 50, z0: r.z, x1: r.x, y1: r.y, z1: r.z,
                            t0: 0, dur: 1, big: false, done: false, ship: null, src: 0 });
  aliens.updateAliens(0.05, 200000);
  eq(r.loot, loot, 'a bolt in flight banked into a melting relay');
});

check('the relay banks what a harvester ships it', () => {
  // The chain is trees -> harvester -> relay -> mothership, and each link has
  // to bank what the one below it spent, or killing the upper links pays out
  // nothing however long the invasion ran. A harvester spends 3 absorbed trees
  // per energy shot, so an arrival is worth exactly 3.
  const { aliens } = fresh();
  const r = aliens.alien.relay;
  r.loot = 0;
  const before = r.loot;
  // an energy bolt that has already completed its flight
  aliens.alien.bolts.push({ x0: r.x, y0: r.y + 50, z0: r.z, x1: r.x, y1: r.y, z1: r.z,
                            t0: 0, dur: 1, big: false, done: false, ship: null, src: 0 });
  aliens.updateAliens(0.05, 5000);
  eq(r.loot - before, 3, 'an arrival must bank the three trees the harvester spent');
});

check('harvesters spread out instead of piling onto one plain', () => {
  // alienPlainsSpot used to return the FIRST candidate inside the 8..60 m
  // height band and weigh nothing else, so every harvester walked onto the
  // same plain: measured over 200 trials, the closest pair had a median of
  // 499 m and 95% of trials put two 1200 m hulls inside one hull length of
  // each other. Scoring separation alongside the height fit takes the median
  // to 1810 m and the overlap rate to 0%.
  const len = 1200;                                  // a hull length to beat
  for (let trial = 0; trial < 12; trial++) {
    const { aliens } = fresh();
    while (aliens.alien.ships.length < 6) aliens.spawnHarvester(false);
    const t = aliens.alien.ships;
    let mn = Infinity, pair = '';
    for (let i = 0; i < t.length; i++)
      for (let j = i + 1; j < t.length; j++) {
        const d = Math.hypot(t[i].tx - t[j].tx, t[i].tz - t[j].tz);
        if (d < mn) { mn = d; pair = i + '/' + j; }
      }
    ok(mn > len, 'trial ' + trial + ': harvesters ' + pair + ' are ' + Math.round(mn) +
       ' m apart, inside one ' + len + ' m hull length');
  }
});

check('the mothership banks what the relay discharges into it', () => {
  const { aliens } = fresh();
  const m = aliens.alien.mother, r = aliens.alien.relay;
  m.loot = 0;
  aliens.alien.bolts.push({ x0: r.x, y0: r.y, z0: r.z, x1: m.x, y1: m.y, z1: m.z,
                            t0: 0, dur: 1, big: true, done: false, ship: null, src: 6 });
  aliens.updateAliens(0.05, 5000);
  eq(m.loot, aliens.RELAY_SHOTS * 3,
     'a discharge is a full relay cycle: RELAY_SHOTS arrivals of three trees each');
});

check('a harvester starts able to count what it eats', () => {
  // weapons.js does `harvest.loot++` on every tree an alien sweep takes, so
  // the field has to exist as a NUMBER at spawn -- undefined++ is NaN, and a
  // NaN payout is silently nothing.
  const { aliens } = fresh();
  for (const s of aliens.alien.ships) {
    eq(typeof s.loot, 'number', 'harvester loot type');
    eq(s.loot, 0, 'a fresh harvester has gathered nothing');
  }
  ok(aliens.alien.ships.length > 0, 'the fleet must start with a harvester');
});

check('a hull that gathered nothing pays nothing', () => {
  const { aliens, paid } = fresh();
  const r = aliens.alien.relay;
  r.loot = 0;
  aliens.alienLaserHit(7, r.x, r.y, r.z);
  for (let i = 0; i < 400 && !r.melt; i++) aliens.updateAliens(0.05, 1000 + i * 50);
  ok(r.melt > 0, 'the relay never reached the melt phase');
  eq(paid.length, 0, 'an empty hull must not call addEnergy at all');
});

// ---- informational: how the hull sits against its own hover altitude ------
// NOT an assertion. updateAliens parks a harvester's CENTRE at terr + 45 m
// during a harvest run, so once shHei/2 passes 45 the hull starts sitting in
// the ground -- a tuning consequence, not a code fault, and Nico may well
// want the buried look. Printed every run so the number is visible when
// someone moves the slider, rather than discovered in flight.
//
// The clamp around that 45 is degenerate as written:
//   Math.min(Math.max(terr + 45, terr + 20), terr + 100)  ===  terr + 45
// The bounds never bind, so the 20/100 range is decoration. Left alone
// deliberately -- changing it is a gameplay change nobody asked for.
{
  const { TUNEA } = fresh();
  const half = TUNEA.shHei.v / 2, hover = 45;
  const clearance = hover - half;
  const pad = '         ';
  console.log('  note  harvester hull vs its hover altitude:');
  console.log(pad + 'shHei ' + TUNEA.shHei.v + ' m -> half-height ' + half + ' m, hover centre terr+' + hover + ' m');
  console.log(pad + 'hull bottom sits terr' + (clearance >= 0 ? '+' : '') + clearance.toFixed(0) + ' m'
              + (clearance < 0 ? '  (BURIED by ' + (-clearance).toFixed(0) + ' m)' : '  (clear)'));
}

process.exitCode = summary('aliens') ? 1 : 0;
