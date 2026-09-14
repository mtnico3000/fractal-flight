// DBG and TUNED are two copies of one truth, and this keeps them equal.
//
// js/dbg.js holds the render settings the GAME reads, so the game can run with
// no debug module at all -- that split is what keeps the Debug panel, the knob
// table and the shader's false-colour channels out of every normal build.
// The cost of the split is a second copy of every default. `test_tune.js`
// already guards `v === d` inside one table because hand-edited pairs drift;
// this is the same failure one file further out, and it is worse: a drift here
// means the game SHIPS one value and the debug build A/Bs against another, so
// every measurement taken through the panel would be against the wrong
// baseline while both files look perfectly reasonable on their own.
const { loadModule, check, eq, ok, summary } = require('./harness');

const { DBG } = loadModule('dbg.js');
const { TUNED } = loadModule('debug.js', { buildPanel: () => {}, copyText: () => {}, DBG: {} });

console.log('dbg');

check('every DBG value is the matching knob default', () => {
  const drift = [];
  for (const key of Object.keys(DBG)) {
    if (key === 'on' || key === 'mask') continue;      // state, not a knob
    const t = TUNED[key];
    if (!t) { drift.push(key + ': no TUNED knob of that name'); continue; }
    if (t.d !== DBG[key]) drift.push(key + ': DBG=' + DBG[key] + ' but TUNED.' + key + '.d=' + t.d);
  }
  ok(drift.length === 0, 'the game and the debug panel disagree --\n         ' + drift.join('\n         '));
});

check('DBG carries every knob the game actually reads', () => {
  // If a module starts reading a new TUNED knob it must be added here too, or
  // the non-debug build silently loses that setting.
  const fs = require('fs'), path = require('path');
  const dir = path.join(__dirname, '..', 'js');
  const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
  const wanted = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (f === 'debug.js' || f === 'dbg.js') continue;
    for (const m of read(f).matchAll(/\bDBG\.(\w+)/g)) wanted.add(m[1]);
  }
  const missing = [...wanted].filter(k => !(k in DBG));
  ok(missing.length === 0, 'js/ reads DBG keys that dbg.js does not define: ' + missing.join(', '));
});

check('the shipped state is not a debug build', () => {
  const { DEBUG_BUILD } = loadModule('dbgflag.js');
  eq(DEBUG_BUILD, false, 'js/dbgflag.js must ship false -- serve.py --debug serves it as true');
  eq(DBG.on, false, 'DBG.on must start false');
  eq(DBG.mask, 0, 'DBG.mask must start 0 -- no false-colour channel in a normal build');
});

process.exitCode = summary('dbg') ? 1 : 0;
