// Tuning panel invariants — promoted from the checks used while baking Nico's
// world and fleet into tune.js on 6 Sept 2026.
//
// `v` is the live value and `d` is what RESET restores. They are edited by
// hand, in pairs, across 35 knobs, which is exactly the shape of edit where
// one of the pair gets missed: the symptom is a panel that looks right until
// someone presses RESET and the world silently changes.

const { loadModule, check, eq, ok, summary } = require('./harness');

const { TUNE, TUNEA, TUNED } = loadModule('tune.js');
const panels = { TUNE, TUNEA, TUNED };

console.log('tune');

check('every knob ships with v === d', () => {
  const drift = [];
  for (const [panel, obj] of Object.entries(panels)) {
    for (const [key, t] of Object.entries(obj)) {
      if (t.v !== t.d) drift.push(`${panel}.${key}: v=${t.v} d=${t.d}`);
    }
  }
  ok(drift.length === 0, 'live value and default disagree —\n         ' + drift.join('\n         '));
});

check('every default sits inside its own slider range', () => {
  const bad = [];
  for (const [panel, obj] of Object.entries(panels)) {
    for (const [key, t] of Object.entries(obj)) {
      if (!(t.d >= t.min && t.d <= t.max)) bad.push(`${panel}.${key}: d=${t.d} not in [${t.min}, ${t.max}]`);
    }
  }
  ok(bad.length === 0, 'default outside range —\n         ' + bad.join('\n         '));
});

check('every knob is fully formed (label, range, step, fmt)', () => {
  for (const [panel, obj] of Object.entries(panels)) {
    for (const [key, t] of Object.entries(obj)) {
      const where = `${panel}.${key}`;
      ok(typeof t.label === 'string' && t.label.length, where + ' needs a label');
      ok(t.max > t.min, where + ' needs max > min');
      ok(t.step > 0, where + ' needs a positive step');
      eq(typeof t.fmt, 'function', where + '.fmt');
      eq(typeof t.fmt(t.d), 'string', where + '.fmt(d) return type');
    }
  }
});

check('the three panels hold the expected number of knobs', () => {
  eq(Object.keys(TUNE).length, 20, 'TUNE knob count');
  eq(Object.keys(TUNEA).length, 15, 'TUNEA knob count');
  eq(Object.keys(TUNED).length, 11, 'TUNED (debug) knob count');
});

// Informational, never a failure: a default pinned to a slider end usually
// means the range ran out before the taste did. Three of them were, on
// 6 Sept 2026 (mother len/wid and ship speed), and the ceilings were raised.
const pinned = [];
for (const [panel, obj] of Object.entries(panels)) {
  for (const [key, t] of Object.entries(obj)) {
    if (t.d === t.max) pinned.push(`${panel}.${key} = ${t.d} (at max)`);
    else if (t.d === t.min) pinned.push(`${panel}.${key} = ${t.d} (at min)`);
  }
}
if (pinned.length) console.log('  note  defaults sitting at a slider end:\n         ' + pinned.join('\n         '));

process.exitCode = summary('tune') ? 1 : 0;
