// Boot the whole module graph in jsdom.  (ROADMAP C2, landed 10 Sept 2026)
//
// Every other suite loads ONE module with its imports stubbed. That is precise,
// but it means no test has ever executed the modules together, in the browser's
// own evaluation order, against a DOM. The two bugs this project has actually
// lost a session to were both of that shape:
//
//   * fx.js referenced `camPos` without importing it. Fine in the single-file
//     build (one scope), ReferenceError in the modular one, and it froze the
//     game on the first bomb that reached the ground -- surviving from v8.0
//     because the single file is the one people play.
//   * css/style.css opened with a literal `<style>` line, which silently killed
//     the universal reset for the whole life of the modular build.
//
// check_module_refs.py catches the first class statically. This catches what
// static analysis cannot: a module that throws while EVALUATING -- a bad
// top-level DOM query, a getElementById on an id that got renamed in
// index.html, a call into another module before it has initialised.
//
// It deliberately stops at module evaluation and does NOT press START. Nothing
// past that point is reachable without a GPU: jsdom has no WebGL2, so
// renderer.js cannot get a context and main.js cannot compile a shader.
//
// Needs `npm install` (jsdom). run_tests.js skips this suite with a note when
// node_modules is absent, so a fresh clone still runs everything else.
//
// Gotchas, both learned the hard way and both still true:
//   - jsdom has no matchMedia; something in the graph calls it. Stub it.
//   - do NOT override Node's `performance` with a jsdom one -- Node's is
//     already there, and replacing it breaks timing calls in odd ways.

const fs = require('fs');
const path = require('path');
const { check, eq, ok, summary } = require('./harness');

// Dev-only dependency; see the note in test_glsl.js.
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch {
  console.log('smoke\n  SKIPPED — needs `npm install` (jsdom).\n' +
              '         Dev tooling only; the game itself has no dependencies.');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

console.log('smoke');

// Reuse build.js's own dependency resolution rather than re-implementing it:
// it emits modules in the browser's evaluation order (depth-first post-order),
// which is exactly the order we want to replay.
const { buildSingleFile, RE_IMPORT } = require('../build.js');

check('the module graph evaluates in a DOM without throwing', () => {
  const built = buildSingleFile();
  ok(built.order.length >= 18,
     'expected the whole graph, got ' + built.order.length + ' modules');

  const dom = new JSDOM(read('index.html'), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,      // gives requestAnimationFrame
    url: 'http://localhost:8734/',
  });
  const win = dom.window;

  // --- the stubs, each for a stated reason ---------------------------------
  // jsdom implements no WebGL. Returning null is honest: renderer.js has to
  // cope with a refused context anyway (that is the #err path).
  win.HTMLCanvasElement.prototype.getContext = function (kind) {
    if (kind === '2d') {
      return new Proxy({}, { get: () => () => {} });   // fx overlay draws freely
    }
    return null;
  };
  // not implemented by jsdom, and something in the graph asks for it
  if (!win.matchMedia) {
    win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {},
                              addEventListener() {}, removeEventListener() {} });
  }
  // NOT stubbed on purpose: performance. Node's own is already present and
  // replacing it with jsdom's has bitten this before.
  win.AudioContext = win.webkitAudioContext = function () {
    return new Proxy({}, { get: () => () => ({}) });
  };

  const errors = [];
  win.addEventListener('error', e => errors.push(String(e.message)));

  // Strip imports/exports the same way the harness and build.js do, then run
  // the modules in dependency order inside one shared scope -- which is what
  // the single-file build produces and what the browser does per-module.
  // build.js's OWN import regex, not a copy of it: it has to span newlines,
  // and main.js has multi-line imports that a naive /^import/ leaves
  // half-stripped (the tail `} from './weapons.js';` then parses as garbage).
  // Rebuilt per use because a /g regex carries lastIndex between calls.
  const stripImports = new RegExp(RE_IMPORT.source, RE_IMPORT.flags);
  const stripped = built.order.map(f => {
    const body = read(path.join('js', f))
      .replace(stripImports, '')
      .replace(/^export\s+/gm, '');
    return '/* ' + f + ' */\n' + body;
  }).join('\n');

  // win.eval, not vm.runInContext: `runScripts: 'outside-only'` already
  // contextified this window, and re-contextifying it leaves `document`
  // undefined inside the script. The IIFE + 'use strict' mirrors exactly what
  // build.js wraps the artifact in, so this replays the shipped shape.
  try {
    win.eval('(function(){"use strict";\n' + stripped + '\n})();');
  } catch (e) {
    throw new Error('module graph threw while evaluating: ' + e.message +
                    (e.stack ? '\n         ' + e.stack.split('\n')[1] : ''));
  }
  ok(errors.length === 0, 'window errors during evaluation: ' + errors.join(' | '));
});

check('index.html still carries every id the modules look up', () => {
  // The other half of the same failure: a module evaluates fine but silently
  // does nothing because getElementById returned null and the result was never
  // checked. Renaming an id in index.html is a one-character way to cause it.
  const html = read('index.html');
  const dom = new JSDOM(html);
  const ids = new Set();
  for (const f of fs.readdirSync(path.join(root, 'js'))) {
    if (!f.endsWith('.js')) continue;
    const body = read(path.join('js', f));
    for (const m of body.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      ids.add(m[1]);
    }
  }
  ok(ids.size > 0, 'found no getElementById calls at all — did the regex rot?');
  const missing = [...ids].filter(id => !dom.window.document.getElementById(id));
  ok(missing.length === 0,
     'js/ looks up ids that index.html does not define: ' + missing.join(', '));
  console.log('  note  ' + ids.size + ' element ids resolved against index.html');
});

process.exitCode = summary('smoke') ? 1 : 0;
