// The fx overlay's occlusion-query BUDGET (v9.8).
//
// The overlay has no depth buffer, so every particle's visibility is a GPU
// probe answer keyed to a slot in uFxPos[FXQ] -- and a particle that holds no
// slot is drawn as fully visible, i.e. straight over the mountain in front of
// it. The slot allocator is therefore the only thing standing between a
// harvest ring and being painted on a ridge, and it had been handing its ten
// pop slots to the LAST ten entries of `pops`.
//
// That is the worst possible ten. `collectTreeAt` staggers a blast's pops by
// `j * 0.03` s against a 0.7 s POP_LIFE, so the newest entries are the ones
// that have not STARTED yet, while every ring actually on screen fell through
// to `_q === undefined` and scored full visibility. These tests pin the two
// properties that fix it: slots go to rings being DRAWN, and they rotate so
// that a blast bigger than the pool still gets everyone answered.
const { loadModule, check, eq, ok, summary } = require('./harness');

const ctx2d = new Proxy({}, { get: () => () => {} });
const stubs = {
  TAN_HALF_FOV: 0.7, TRAIL_LIFE: 4.5, POP_LIFE: 0.7, MAXB: 8, MAXBOMB: 3,
  RING_N: 28, BLAST_R: 100,
  FXQ: 48, FXQ_TRAIL: 0, FXQ_BULLET: 16, FXQ_BOMB: 24, FXQ_RING: 27,
  craft: { pos: [0, 0, 0], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1] },
  viewPos: [0, 0, 0],
  document: { getElementById: () => ({ getContext: () => ctx2d, clientWidth: 800, clientHeight: 600, width: 800, height: 600 }) },
};
const fx = loadModule('fx.js', stubs, ['slotRings', 'impactLife', 'fxVis']);
const POOL = stubs.FXQ - stubs.FXQ_RING;          // 21 shared ring slots
const arr = new Float32Array(stubs.FXQ * 3);

// A bomb pops up to BLASTC trees at once, staggered over 1.1 s.
function blast(now, n) {
  fx.pops.length = 0;
  for (let j = 0; j < n; j++) fx.pops.push({ x: j, y: 0, z: 0, t0: now + Math.min(j * 0.03, 1.1) * 1000 });
}
const live = now => fx.pops.filter(p => { const a = (now - p.t0) / 1000; return a >= 0 && a <= stubs.POP_LIFE; });

check('a blast\u2019s slots go to the rings being DRAWN, not the newest in the array', () => {
  const now = 1e6;
  blast(now, 64);
  // 0.5 s in: the early pops are on screen, the late ones have not started
  const t = now + 500;
  fx.buildFxQueries(arr, t, [], [], []);
  const drawn = live(t);
  ok(drawn.length > 0, 'the sample must actually have rings on screen');
  const slotted = fx.pops.filter(p => p._q !== undefined);
  for (const p of slotted) {
    const age = (t - p.t0) / 1000;
    ok(age >= 0 && age <= stubs.POP_LIFE, 'slot went to a ring that is not being drawn (age ' + age.toFixed(2) + ' s)');
  }
  eq(slotted.length, Math.min(drawn.length, POOL), 'slots filled');
});

check('every live ring is answered within a few frames (round robin)', () => {
  const now = 2e6;
  blast(now, 64);
  const t = now + 900;                            // mid-blast: more live rings than slots
  const drawn = live(t);
  ok(drawn.length > POOL, 'sample must oversubscribe the pool, got ' + drawn.length);
  const seen = new Set();
  for (let frame = 0; frame < 6; frame++) {
    fx.buildFxQueries(arr, t, [], [], []);
    for (const p of fx.pops) {
      if (p._q === undefined) continue;
      seen.add(p);
      p._vis = 1; p._vt = frame;                  // latch, as drawTrail does
    }
  }
  for (const p of drawn) ok(seen.has(p), 'a live ring went unanswered for 6 frames');
});

check('a ring is never drawn blind: the unanswered are served first', () => {
  const now = 3e6;
  blast(now, 64);
  const t = now + 400;
  fx.buildFxQueries(arr, t, [], [], []);
  for (const p of fx.pops) if (p._q !== undefined) { p._vis = 0.5; p._vt = 1; }
  // a fresh pop appears with no answer at all — it must take a slot at once
  const fresh = { x: 999, y: 0, z: 0, t0: t };
  fx.pops.push(fresh);
  fx.buildFxQueries(arr, t, [], [], []);
  ok(fresh._q !== undefined, 'a never-answered ring did not get a slot');
  eq(arr[fresh._q * 3], 999, 'the slot was not packed with that ring\u2019s position');
});

check('pops and impacts share one pool instead of stranding a fixed cut', () => {
  const now = 4e6;
  fx.pops.length = 0;
  const impacts = [];
  for (let j = 0; j < 40; j++) fx.pops.push({ x: j, y: 0, z: 0, t0: now });
  fx.buildFxQueries(arr, now, [], [], impacts);
  eq(fx.pops.filter(p => p._q !== undefined).length, POOL, 'pops alone should be able to take the whole pool');
  fx.pops.length = 0;
  for (let j = 0; j < 40; j++) impacts.push({ x: j, y: 0, z: 0, t0: now, kind: 0 });
  fx.buildFxQueries(arr, now, [], [], impacts);
  eq(impacts.filter(p => p._q !== undefined).length, POOL, 'impacts alone should be able to take the whole pool');
});

check('the slot map covers the row exactly, with no overlap and no gap', () => {
  const now = 5e6;
  fx.trail.length = 0;
  for (let i = 0; i < 300; i++) fx.trail.push({ x: i, y: 0, z: 0, t0: now });
  const bullets = [], bombs = [], impacts = [];
  for (let i = 0; i < stubs.MAXB; i++) bullets.push({ x: i, y: 1, z: 0 });
  for (let i = 0; i < stubs.MAXBOMB; i++) bombs.push({ x: i, y: 2, z: 0 });
  for (let i = 0; i < 30; i++) impacts.push({ x: i, y: 3, z: 0, t0: now, kind: 0 });
  fx.buildFxQueries(arr, now, bullets, bombs, impacts);
  const used = new Map();
  const claim = (p, who) => {
    if (p._q === undefined) return;
    ok(p._q >= 0 && p._q < stubs.FXQ, who + ' claimed slot ' + p._q + ' outside the row');
    ok(!used.has(p._q) || used.get(p._q) === who, 'slot ' + p._q + ' claimed by both ' + used.get(p._q) + ' and ' + who);
    used.set(p._q, who);
  };
  for (const p of fx.trail) claim(p, 'trail');
  for (const p of bullets) claim(p, 'bullet');
  for (const p of bombs) claim(p, 'bomb');
  for (const p of impacts) claim(p, 'ring');
  eq(used.size, stubs.FXQ, 'every slot in the row should be earning its keep here');
});

check('the draw loop and the allocator agree on how long a ring lives', () => {
  // they are two readings of the same table; if they drift, the allocator
  // spends slots on rings nobody draws — the original bug, in miniature
  eq(fx.impactLife(3), 0.9, 'bomb ring');
  eq(fx.impactLife(4), 0.8, 'hull burst');
  eq(fx.impactLife(0), 0.45, 'ground spit');
  eq(fx.impactLife(2), 0.45, 'water spray');
});

process.exit(summary('fx') ? 1 : 0);
