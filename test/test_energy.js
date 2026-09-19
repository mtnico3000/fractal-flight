// The ENERGY economy (v9.9).
//
// One pool now feeds and funds everything: the ring course and the flora pay
// into it, the laser spends it. That makes the numbers a GAME BALANCE contract
// rather than two independent scores, and every one of them is a silent
// failure if it drifts — a laser that costs 0 never runs out, a ring worth 1
// makes the course pointless, and a spend that goes negative arms a weapon the
// player has not earned.
const { loadModule, check, eq, ok, summary } = require('./harness');

const el = { textContent: '', classList: { toggle() {} } };
const E = loadModule('energy.js', { document: { getElementById: () => el } });

check('the pool starts at exactly two shots', () => {
  E.resetEnergy();
  eq(E.getEnergy(), 200, 'start');
  eq(E.START_ENERGY, 200, 'START_ENERGY');
  // 200 / 100 is a deliberate ratio, not a coincidence: you open with two
  // shots and the third has to be earned. Pinned as a ratio so moving either
  // number without meaning to changes a test rather than the game quietly.
  eq(E.START_ENERGY / E.LASER_COST, 2, 'opening shots');
});

check('a ring is worth exactly one laser', () => {
  eq(E.RING_ENERGY, E.LASER_COST,
     'the course is the reliable way to re-arm; if a ring is not one shot, say so deliberately');
});

check('a tree is a top-up, not an alternative', () => {
  eq(E.SPORE_ENERGY, 1, 'spore value');
  ok(E.SPORE_ENERGY * 20 < E.LASER_COST,
     'flora must not out-earn the ring course: ' + E.SPORE_ENERGY + ' x 20 >= ' + E.LASER_COST);
});

check('spending is all-or-nothing, so a shot cannot half-fire', () => {
  E.resetEnergy();
  eq(E.spendEnergy(E.LASER_COST), true, 'first shot affordable');
  eq(E.getEnergy(), 100, 'after one shot');
  eq(E.spendEnergy(E.LASER_COST), true, 'second shot affordable');
  eq(E.getEnergy(), 0, 'after two shots');
  eq(E.spendEnergy(E.LASER_COST), false, 'a third must be refused');
  eq(E.getEnergy(), 0, 'a refused spend must take NOTHING');
});

check('the pool never goes negative', () => {
  E.resetEnergy();
  for (let i = 0; i < 50; i++) E.spendEnergy(E.LASER_COST);
  ok(E.getEnergy() >= 0, 'energy went negative: ' + E.getEnergy());
});

check('canFireLaser agrees with what spendEnergy will actually do', () => {
  // They are two answers to one question and the laser asks BOTH: the check
  // gates the trigger, the spend gates the shot. Disagreement means an armed
  // reticle that fires nothing.
  //
  // ⚠️ Sweep every value across the threshold, NOT just multiples of the cost.
  // The first version of this spent 100 at a time from 200 and so only ever
  // sampled 200/100/0 — where `energy > 0` and `energy >= 100` happen to give
  // the same answer. The mutant that breaks canFireLaser walked straight
  // through it. The bug lives strictly BETWEEN 0 and the cost.
  for (let target = 0; target <= 2 * E.LASER_COST; target += 10) {
    E.resetEnergy();
    E.spendEnergy(E.getEnergy() - target >= 0 ? 0 : 0);
    E.addEnergy(target - E.getEnergy());          // land exactly on `target`
    eq(E.getEnergy(), target, 'setup');
    const said = E.canFireLaser();
    const did = E.spendEnergy(E.LASER_COST);
    eq(did, said, 'disagreement at ' + target + ' energy (said ' + said + ', did ' + did + ')');
    eq(said, target >= E.LASER_COST, 'canFireLaser wrong at ' + target);
  }
});

check('earning re-arms the laser', () => {
  E.resetEnergy();
  E.spendEnergy(E.LASER_COST); E.spendEnergy(E.LASER_COST);
  eq(E.canFireLaser(), false, 'broke');
  E.addEnergy(E.RING_ENERGY);
  eq(E.canFireLaser(), true, 'one ring must re-arm it');
  E.resetEnergy();
  eq(E.getEnergy(), 200, 'R returns the pool to START, not to what was left');
});

process.exitCode = summary('energy') ? 1 : 0;
