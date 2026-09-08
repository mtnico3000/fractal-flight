// Documentation drift guards.
//
// The README's Structure block listed the v5 module set until 6 Sept 2026:
// aliens.js and tune.js — two whole features — were missing, and it is the
// first thing a new contributor (or jul) reads. Nobody notices a file that
// isn't there, so this is checked rather than remembered.

const fs = require('fs');
const path = require('path');
const { check, ok, summary } = require('./harness');

const root = path.join(__dirname, '..');
// Line endings normalized, same reason build.js does it: core.autocrlf is on
// by default on Windows, so a fresh clone -- or even a `git checkout -b` --
// hands these files back as CRLF, and every regex here anchored on a newline
// silently stops matching. Cost a red suite on the a1-resolution branch.
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const readme = read('README.md');
const claude = read('CLAUDE.md');
const modules = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).sort();

console.log('docs');

check('README Structure lists every js/ module', () => {
  const missing = modules.filter(m => !readme.includes(m));
  ok(missing.length === 0, 'not listed in README.md: ' + missing.join(', '));
});

check('README lists no module that no longer exists', () => {
  const listed = [...readme.matchAll(/^\s{2}([a-z_]+\.js)\s/gm)].map(m => m[1]);
  const ghosts = listed.filter(f => !modules.includes(f));
  ok(ghosts.length === 0, 'listed in README.md but gone from js/: ' + ghosts.join(', '));
});

check('CLAUDE.md architecture map covers every js/ module', () => {
  const missing = modules.filter(m => !claude.includes(m));
  ok(missing.length === 0, 'not mentioned in CLAUDE.md: ' + missing.join(', '));
});

check('CLAUDE.md still states the module count correctly', () => {
  const m = claude.match(/(\d+)\s+js\/ modules/);
  ok(m, 'CLAUDE.md should say how many js/ modules there are');
  ok(Number(m[1]) === modules.length,
     'CLAUDE.md says ' + m[1] + ' js/ modules, there are ' + modules.length);
});

check('the README Running command is serve.py, not the bare http.server', () => {
  // Prose may — and does — name `python -m http.server` in order to warn
  // against it. What must not regress is the command someone copies: the
  // first fenced block under ## Running.
  const running = readme.split('## Running')[1] || '';
  const fence = (running.match(/```sh\n([\s\S]*?)```/) || [])[1] || '';
  ok(fence.includes('serve.py'), 'the Running command block should invoke serve.py');
  ok(!/-m http\.server/.test(fence),
     'the Running command block still tells people to use the bare http.server, which caches modules');
});

process.exitCode = summary('docs') ? 1 : 0;
