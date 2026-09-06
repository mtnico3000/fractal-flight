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
  const craft = { pos: [1e6, 1e6, 1e6] };   // far from everything by default
  const crashes = [];
  const aliens = loadModule('aliens.js', {
    TUNEA,
    craft,
    terrainShapeJ: () => GROUND,
    collectedSet: new Set(),
    bombs: [null, null, null],
    impacts: [],
    blastQueue: [],
    explosionSound: () => {},
    zapSound: () => {},
    relayBlastSound: () => {},
    doCrash: (why) => crashes.push(why),
  }, ['HP_MOTHER', 'HP_SHIP', 'HP_RELAY', 'hullAlive', 'bombs', 'craft']);
  aliens.initAliens();
  return { aliens, craft, crashes, TUNEA };
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

function crashedAt(aliens, craft, crashes, obj) {
  crashes.length = 0;
  craft.pos[0] = obj.x; craft.pos[1] = obj.y; craft.pos[2] = obj.z;
  aliens.updateAliens(1 / 60, 3000);
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

process.exitCode = summary('aliens') ? 1 : 0;
