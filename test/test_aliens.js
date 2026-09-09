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
  const aliens = loadModule('aliens.js', {
    TUNEA,
    HULL_BLAST_R,
    craft,
    terrainShapeJ: () => GROUND,
    collectedSet: new Set(),
    bombs: [null, null, null],
    impacts: [],
    blastQueue: [],
    hullExplosionSound: () => {},
    zapSound: () => {},
    relayBlastSound: () => { blasts.push(1); },
    doCrash: (why) => crashes.push(why),
  }, ['HP_MOTHER', 'HP_SHIP', 'HP_RELAY', 'hullAlive', 'bombs', 'craft',
      'boxFace', 'sphereFace', 'HULL_BLAST_R']);
  aliens.initAliens();
  return { aliens, craft, crashes, blasts, TUNEA };
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
  const half = [TUNEA.shLen.v / 2, TUNEA.shHei.v / 2, TUNEA.shWid.v / 2];
  const ship = { x: 0, y: 100, z: 0, a: 0 };
  const top = aliens.boxFace({ x: 0, y: 100 + half[1] - 1, z: 0 }, ship, half, true);
  const side = aliens.boxFace({ x: 0, y: 100, z: half[2] - 1 }, ship, half, true);
  eq(top.maxR, aliens.HULL_BLAST_R, 'a broad deck should get the full blast radius');
  ok(side.maxR < aliens.HULL_BLAST_R,
     'a flank is only ' + (half[1] * 2) + ' m tall, so the ring must shrink to fit: got ' + side.maxR);
  ok(side.maxR <= half[1], 'the ring must not hang off the face: ' + side.maxR + ' > ' + half[1]);
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

// --- the invasion economy's pacing ------------------------------------------
// The relay's size and the time it takes to blast are separate concerns that
// share one number. Growing the bulb 5x meant the per-arrival increment had to
// grow with it, or the blast would simply never arrive. This drives the REAL
// updateAliens path rather than re-deriving the formula, so a hard-coded
// increment creeping back in shows up here.
check('resizing the relay does not change how long it takes to blast', () => {
  const { aliens, blasts } = fresh();
  const r = aliens.alien.relay;
  const base = r.baseR;
  let n = 0;
  while (blasts.length === 0 && n < 400) {
    // one delivered energy shot per step: t0 far enough back to count as arrived
    aliens.alien.bolts.push({ x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0,
                              t0: 0, dur: 1, big: false, done: false, ship: null, src: 0 });
    aliens.updateAliens(1 / 60, 10000 + n);
    n++;
  }
  eq(n, 50, 'energy arrivals from base size to relay blast');
  ok(Math.abs(r.r - base) < 1e-9, 'the relay resets to its base radius after blasting');
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

process.exitCode = summary('aliens') ? 1 : 0;
