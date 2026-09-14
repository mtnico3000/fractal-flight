// The chase camera's rest pose (13 Sept 2026). Observation mode's Debug
// 'obs camera' = snap parks the camera at chasePose() every frame instead of
// letting the springs glide there (~3 s), so a screenshot taken right after an
// arrow tap is at the settled framing. That is only true if chasePose() really
// IS the springs' fixed point: the pose that, fed back through the camera's
// own equations, comes out unchanged. The live game measured its resting
// camera at 15.7 m behind and 8.5 m above the craft, pitched 10.6 deg down --
// pinned here too, so the solver cannot drift from what the springs do.
const { loadModule, check, ok, summary } = require('./harness');

const math = loadModule('math.js');
const noop = () => {};
const stubs = {
  WATER_LEVEL: -8, GRIND_DEPTH: 0, START: { x: 0, y: 480, z: 0 },
  craft: { pos: [0, 0, 0], r: [-1, 0, 0], u: [0, 1, 0], f: [0, 0, 1], speed: 0, rollVel: 0, pitchVel: 0 },
  craftB: noop, camPos: [0, 0, 0], viewPos: [0, 0, 0], viewZoom: { t: 1, cockpit: 0 },
  camMode: { free: false, pilot: false, obs: false },
  pilotAim: { on: 0, fwd: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  flags: {}, probe: { ground: null },
  normalize3: math.normalize3, cross3: math.cross3, rotV: math.rotV, clamp1: math.clamp1,
  keys: {}, touchInput: {}, gyroInput: {}, mouse: {}, mouseView: { x: 0, y: 0 }, viewOrigin: { x: 0, y: 0 }, IS_TOUCH: false,
  terrainShapeJ: () => 0, doCrash: noop, unCrash: noop, collectTree: noop, updateRings: noop, initRings: noop,
  fireGun: noop, updateBullets: noop, updateBombs: noop, resolveBlasts: noop, driftClouds: noop, cloudImmersion: () => 0,
  updateAliens: noop, initAliens: noop, engineUpdate: noop, grindUpdate: noop, cloudWindUpdate: noop, emitTrail: noop,
  DBG: { obsCam: 0 },
};
const F = loadModule('flight.js', stubs, ['chasePose']);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = v => Math.hypot(v[0], v[1], v[2]);
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg + ': ' + a.toFixed(4) + ' vs ' + b);

console.log('flight');

check('chasePose reproduces the chase camera measured live: 15.7 m back, 8.5 m up, 10.6 deg down', () => {
  stubs.craft.pos[0] = 0; stubs.craft.pos[1] = 0; stubs.craft.pos[2] = 0;
  const p = F.chasePose([0, 0, 1], 30, 17, 5.5, 0);
  near(p.pos[2], -15.70, 0.01, 'behind the craft (z)');
  near(p.pos[1], 8.52, 0.01, 'above the craft (y)');
  near(p.pos[0], 0, 1e-9, 'sideways (x)');
  near(Math.asin(-p.f[1]) * 180 / Math.PI, 10.56, 0.01, 'pitch down, deg');
});

check("the pose is the springs' fixed point: fed back through the camera equations it does not move", () => {
  const C = stubs.craft.pos; C[0] = 1490; C[1] = 287; C[2] = 2490;
  // (heading, look-ahead, arm back, arm up, lag): the default rig, Nico's
  // heading, a 2x wheel zoom, and the Y-off snap's cruise-speed lag term
  for (const [hdg, la, zd, zh, lag] of [[0, 30, 17, 5.5, 0], [37, 30, 17, 5.5, 0], [200, 60, 34, 8.6, 0], [90, 57, 17, 5.5, 27]]) {
    const f = [Math.sin(hdg * Math.PI / 180), 0, Math.cos(hdg * Math.PI / 180)];
    const p = F.chasePose(f, la, zd, zh, lag);
    const tag = ' (hdg ' + hdg + ', la ' + la + ', arm ' + zd + '/' + zh + ', lag ' + lag + ')';
    // 1. the camF spring pulls toward the point (la - lag) ahead of the craft: at rest it already points there
    const target = [0, 1, 2].map(i => C[i] + f[i] * (la - lag));
    const dir = math.normalize3([0, 1, 2].map(i => target[i] - p.pos[i]));
    ok(len([0, 1, 2].map(i => dir[i] - p.f[i])) < 1e-4, 'camF is not at rest' + tag);
    // 2. the camPos spring pulls toward pos - camF*arm + camU*height (- lag): at rest it is already there
    const want = [0, 1, 2].map(i => C[i] - p.f[i] * zd + p.u[i] * zh - f[i] * lag);
    ok(len([0, 1, 2].map(i => want[i] - p.pos[i])) < 1e-6, 'camPos is not at rest' + tag);
    // 3. an orthonormal basis with a level horizon
    ok(Math.abs(len(p.f) - 1) < 1e-12 && Math.abs(len(p.r) - 1) < 1e-12 && Math.abs(len(p.u) - 1) < 1e-12, 'basis is not unit' + tag);
    ok(Math.abs(dot(p.f, p.r)) < 1e-12 && Math.abs(dot(p.f, p.u)) < 1e-12 && Math.abs(dot(p.r, p.u)) < 1e-12, 'basis is not orthogonal' + tag);
    ok(Math.abs(p.r[1]) < 1e-12, 'horizon is not level' + tag);
  }
});

process.exitCode = summary('flight') ? 1 : 0;
