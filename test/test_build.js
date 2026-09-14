// The single-file build must never drift from the modules again.
//
// It drifted for a whole version line: the shipped fractal-flight-v9_1b.html
// was missing the tuning-panel overflow fix, the tuned world/fleet defaults,
// the alien bomb constants, hullAlive(), and the camPos→viewPos freeze fix —
// because it was hand-maintained in parallel with js/. ROADMAP C1 replaced
// that with build.js, and this is what makes "never edit the artifact"
// enforceable rather than merely written down: the artifact in the repo has
// to be byte-identical to what build.js produces from the current source.
//
// Failure here is never a puzzle. Run `node build.js` and commit the result.

const fs = require('fs');
const path = require('path');
const { check, ok, summary } = require('./harness');
const { buildSingleFile, artifactName } = require('../build.js');

const root = path.join(__dirname, '..');

console.log('build');

let built = null;

check('build.js produces a single-file build from the modules', () => {
  built = buildSingleFile();
  ok(built.html.length > 100000, 'the artifact came out suspiciously small');
  ok(built.order[built.order.length - 1] === 'main.js', 'main.js must be evaluated last');
});

check('the committed artifact matches what build.js generates', () => {
  const name = artifactName(built.version);
  const file = path.join(root, name);
  ok(fs.existsSync(file), name + ' is missing — run `node build.js`');
  const have = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  ok(have === built.html, name + ' is stale — run `node build.js` and commit it');
});

// js/debug.js is the ONE module that must not reach the artifact: the
// double-click build ships with no debug surface at all. It is reached by a
// single dynamic import in main.js which build.js cuts out.
const NOT_IN_ARTIFACT = ['debug.js'];

check('every js/ module reaches the bundle, except the debug one', () => {
  const modules = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).sort();
  const missing = modules.filter(m => !built.order.includes(m) && !NOT_IN_ARTIFACT.includes(m));
  ok(missing.length === 0, 'not in the bundle: ' + missing.join(', '));
  for (const f of NOT_IN_ARTIFACT) {
    ok(fs.existsSync(path.join(root, 'js', f)), 'js/' + f + ' is missing');
    ok(!built.order.includes(f), 'js/' + f + ' reached the artifact — the single file must ship with no debug build');
  }
});

// A concatenation is one scope, so an `import` or `export` surviving the strip
// is a syntax error in the artifact — and a browser reports it as a blank page,
// not as a message anyone can act on.
check('no import/export keyword survives into the artifact', () => {
  const script = /<script>\n\(function \(\) \{\n'use strict';\n([\s\S]*?)\n\}\)\(\);\n<\/script>/.exec(built.html);
  ok(script, 'the bundled <script> block is not shaped as expected');
  const leftover = script[1].match(/^[ \t]*(?:import|export)\s/gm);
  ok(!leftover, 'leftover module syntax: ' + (leftover || []).join(' | '));
});

// The whole point of the artifact is that it runs from a double-clicked
// file:// page, where every network fetch fails silently.
check('the artifact is self-contained (nothing to fetch)', () => {
  const refs = built.html.match(/\b(?:src|href)="(?!#)[^"]*"/g) || [];
  ok(refs.length === 0, 'external references left in the artifact: ' + refs.join(', '));
  ok(!/<link\b/i.test(built.html), 'a <link> survived into the artifact');
  ok(!/\bfetch\(|XMLHttpRequest|importScripts|new Worker/.test(built.html),
     'the artifact fetches something at runtime');
});

// index.html tells file:// visitors that ES modules are why nothing loaded.
// That message is right for the modular build and wrong for this one, where
// a failure is a real bug rather than a CORS rule.
check('the file:// module warning is switched off in the artifact', () => {
  ok(/var __ffModular = false;/.test(built.html), 'the watchdog still claims to be the modular build');
});

process.exitCode = summary('build') ? 1 : 0;
