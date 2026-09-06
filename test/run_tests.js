// One command for the whole suite:  node test/run_tests.js
//
// Runs every test_*.js in this folder, then the Python module-reference check
// (kept in Python because that is what it was written and proven red in; it is
// skipped with a note, not failed, if Python is unavailable).
//
// This is ROADMAP C2 starting. There is no npm and no test framework on
// purpose — same reasoning as the no-bundler decision for the game itself.

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const here = __dirname;
const tests = fs.readdirSync(here).filter(f => /^test_.*\.js$/.test(f)).sort();

let failed = 0;

for (const t of tests) {
  console.log('\n=== ' + t + ' ===');
  const r = spawnSync(process.execPath, [path.join(here, t)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log('\n=== check_module_refs.py ===');
let ran = false;
for (const py of ['python', 'python3']) {
  const r = spawnSync(py, [path.join(here, 'check_module_refs.py')], { stdio: 'inherit' });
  if (r.error) continue;          // interpreter not found — try the next name
  ran = true;
  if (r.status !== 0) failed++;
  break;
}
if (!ran) console.log('  SKIPPED — no python on PATH (this check guards the modular/single-file\n  divergence that froze the game on 6 Sept 2026; do run it before a release)');

console.log('\n' + (failed ? failed + ' suite(s) FAILED' : 'all suites passed'));
process.exit(failed ? 1 : 0);
