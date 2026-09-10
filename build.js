#!/usr/bin/env node
//
// build.js — generate the single-file build from the modular source.
//
//     node build.js            write fractal-flight-vX_Y.html
//     node build.js --check    build in memory and fail if the committed
//                              artifact differs (used by test/test_build.js)
//
// ROADMAP C1. Until now the split build (index.html + css/ + js/) and the
// double-click single file were maintained BY HAND, in parallel, and they
// drifted: the v9.1b single file was missing the tuning-panel overflow fix,
// the tuned defaults, the alien bomb constants and the camPos→viewPos freeze
// fix. From here the single file is an ARTIFACT — never edit it, edit the
// modules and re-run this.
//
// The transform is deliberately tiny and dependency-free, same reasoning as
// the game having no bundler. It
//
//   1. resolves the module graph from js/main.js and orders the modules the
//      way the browser evaluates them (depth-first post-order), so the
//      concatenation behaves like the ES-module build rather than merely
//      looking like it;
//   2. strips the `import` statements and the `export ` keywords;
//   3. refuses to build if two modules declare the same top-level name —
//      legal today in separate module scopes, a silent overwrite tomorrow in
//      the one shared scope;
//   4. inlines css/style.css and flips the index.html watchdog flag;
//   5. wraps the result in an IIFE with 'use strict', so the single file keeps
//      module semantics instead of publishing 200 globals.
//
// Step 3 catches collisions. It does NOT catch the opposite hazard — a module
// USING another module's export without importing it, which works in one
// shared scope and throws in the modular build — so the build also runs
// test/check_module_refs.py, the guard written for that exact freeze.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const ENTRY = 'main.js';

function die(msg) {
  console.error('build.js: ' + msg);
  process.exit(1);
}

// Read a source file with its line endings normalized to LF, so the artifact
// is byte-identical whatever the working tree holds. git's core.autocrlf is
// on by default on Windows, which means a fresh clone there gives every file
// CRLF — without this the artifact would come out CRLF-flavoured on one
// machine and LF on another, and `--check` would call it stale forever.
function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------- scanning

// A same-length copy of the source with comments and string/template literals
// replaced by spaces (newlines kept), so an index found here is valid in the
// original too. Without it shaders.js — one 1000-line GLSL template — would
// have every `//` inside the shader read as a JS comment.
function blank(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const two = src.substr(i, 2);
    let j;
    if (two === '//') {
      j = src.indexOf('\n', i);
      if (j < 0) j = n;
    } else if (two === '/*') {
      j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        j++;
      }
    } else {
      out += c;
      i++;
      continue;
    }
    for (let k = i; k < j; k++) out += (src[k] === '\n' ? '\n' : ' ');
    i = j;
  }
  return out;
}

// Matched against the BLANKED source, where the module specifier is already
// spaces — so the specifier is read back out of the raw text at these indices.
const RE_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*[^;\n]*;?[ \t]*\r?\n?/gm;
const RE_EXPORT_KW = /^export\s+(?=(?:async\s+)?(?:const|let|var|function|class)\b)/gm;
const RE_LEFTOVER = /^[ \t]*(?:import|export)\b.*/m;
const UNSUPPORTED = [[/[^.\w$]import\s*\(/m, 'dynamic import()']];

// Every name declared at column 0 — this codebase indents everything nested,
// so column 0 is exactly module scope. Handles `let a = 0, b = 0;` and
// records which declarations carried `export`.
function topLevelDecls(code) {
  const out = [];
  const re = /^(export\s+)?(?:async\s+)?(const|let|var|function|class)\s+/gm;
  let m;
  while ((m = re.exec(code))) {
    const exported = !!m[1];
    const kind = m[2];
    let i = m.index + m[0].length;

    if (kind === 'function' || kind === 'class') {
      const id = /^[A-Za-z_$][\w$]*/.exec(code.slice(i));
      if (id) out.push({ name: id[0], exported });
      continue;
    }

    // const/let/var: walk the declarator list to its terminating `;`, taking
    // every identifier that sits at bracket depth 0.
    let depth = 0;
    let expectName = true;
    while (i < code.length) {
      const c = code[i];
      if (c === '(' || c === '[' || c === '{') { depth++; i++; continue; }
      if (c === ')' || c === ']' || c === '}') { depth--; i++; continue; }
      if (depth === 0 && c === ';') break;
      if (depth === 0 && c === ',') { expectName = true; i++; continue; }
      if (depth === 0 && c === '=') { expectName = false; i++; continue; }
      if (expectName && /[A-Za-z_$]/.test(c)) {
        const id = /^[A-Za-z_$][\w$]*/.exec(code.slice(i))[0];
        out.push({ name: id, exported });
        expectName = false;
        i += id.length;
        continue;
      }
      i++;
    }
  }
  return out;
}

function readModule(file) {
  const full = path.join(ROOT, 'js', file);
  if (!fs.existsSync(full)) die('js/' + file + ' does not exist');
  const raw = read(full);
  const code = blank(raw);

  const imports = [];
  const cuts = [];
  let m;

  RE_IMPORT.lastIndex = 0;
  while ((m = RE_IMPORT.exec(code))) {
    const end = m.index + m[0].length;
    const spec = (/['"]([^'"]+)['"]/.exec(raw.slice(m.index, end)) || [])[1];
    if (!spec || !/^\.\/[\w.-]+\.js$/.test(spec)) {
      die('js/' + file + ' imports "' + spec + '" — only ./sibling.js is supported');
    }
    imports.push({ file: spec.slice(2), names: m[1].split(',').map(s => s.trim()).filter(Boolean) });
    cuts.push([m.index, end]);
  }

  RE_EXPORT_KW.lastIndex = 0;
  while ((m = RE_EXPORT_KW.exec(code))) cuts.push([m.index, m.index + m[0].length]);

  // Total check: nothing that looks like an import or export may survive the
  // cuts. Anything left is a form this builder does not understand (a default
  // import, an `export { ... }` list, a side-effect import) and would either
  // become a syntax error in the bundle or silently drop a binding.
  let residual = code;
  for (const [a, b] of cuts.slice().sort((x, y) => y[0] - x[0])) {
    residual = residual.slice(0, a) + ' '.repeat(b - a) + residual.slice(b);
  }
  const left = RE_LEFTOVER.exec(residual);
  if (left) die('js/' + file + ' has an import/export form build.js does not handle:\n          ' + left[0].trim());
  for (const [re, what] of UNSUPPORTED) {
    if (re.test(code)) die('js/' + file + ' uses ' + what + ', which build.js does not handle');
  }

  const decls = topLevelDecls(code);
  return {
    file, raw, imports, cuts,
    declared: decls.map(d => d.name),
    exports: decls.filter(d => d.exported).map(d => d.name),
  };
}

// -------------------------------------------------------------- the bundle

function buildBundle() {
  const mods = new Map();
  const order = [];
  const visiting = new Set();

  // Depth-first post-order over the import graph is the browser's own module
  // evaluation order, so top-level code runs in the same sequence it does
  // today. A hard-coded list would work until someone adds an import;
  // deriving it cannot go stale.
  (function visit(file, stack) {
    if (visiting.has(file)) die('import cycle: ' + stack.concat(file).join(' -> '));
    if (mods.has(file)) return;
    visiting.add(file);
    const mod = readModule(file);
    for (const imp of mod.imports) visit(imp.file, stack.concat(file));
    visiting.delete(file);
    mods.set(file, mod);
    order.push(file);
  })(ENTRY, []);

  const onDisk = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).sort();
  const orphans = onDisk.filter(f => !mods.has(f));
  if (orphans.length) die('js/ holds module(s) nothing imports: ' + orphans.join(', '));

  // Every imported name must really be exported. The modular build reports
  // this at load time; a blind concatenation would not report it at all.
  for (const file of order) {
    for (const imp of mods.get(file).imports) {
      for (const name of imp.names) {
        if (!mods.get(imp.file).exports.includes(name)) {
          die('js/' + file + ' imports { ' + name + ' } from ./' + imp.file +
              ', which does not export it');
        }
      }
    }
  }

  // One scope from here on: two modules may not declare the same top-level name.
  const owner = new Map();
  const clashes = [];
  for (const file of order) {
    for (const name of mods.get(file).declared) {
      if (owner.has(name)) clashes.push(name + '  (js/' + owner.get(name) + ' and js/' + file + ')');
      else owner.set(name, file);
    }
  }
  if (clashes.length) {
    die('top-level name collision — legal in separate module scopes, a silent\n' +
        '        overwrite in the single file:\n          ' + clashes.join('\n          '));
  }

  const parts = order.map(file => {
    const mod = mods.get(file);
    let out = mod.raw;
    for (const [a, b] of mod.cuts.slice().sort((x, y) => y[0] - x[0])) {
      out = out.slice(0, a) + out.slice(b);
    }
    out = out.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '');
    return '// ==================== js/' + file + ' ====================\n' + out + '\n';
  });

  const text = parts.join('\n');

  // The bundle must at least PARSE. Nothing else here reads the modules as
  // code -- they are concatenated as text -- so without this a JS syntax
  // error sails through the build and the whole test suite, and first shows
  // up as a blank page. It is not hypothetical: writing `detail fade` in a
  // comment inside shaders.js closed the GLSL template literal early and
  // turned the rest of the shader into stray JS tokens. new Function()
  // compiles without running, so nothing in the game executes here.
  try {
    new Function(text);   // eslint-disable-line no-new-func
  } catch (e) {
    die('the bundle is not valid JavaScript: ' + e.message +
        '\n        A module has a syntax error. Watch for backticks in a comment\n' +
        '        inside shaders.js -- they end the GLSL template early.');
  }

  return { text, order };
}

// ---------------------------------------------------------------- the page

function replaceOnce(html, needle, replacement, what) {
  const parts = html.split(needle);
  if (parts.length !== 2) die('index.html: expected exactly one ' + what + ', found ' + (parts.length - 1));
  return parts.join(replacement);
}

function buildSingleFile() {
  const html = read(path.join(ROOT, 'index.html'));
  const css = read(path.join(ROOT, 'css', 'style.css')).replace(/\s+$/, '');
  const { text, order } = buildBundle();

  const version = (/<title>[^<]*?(v[\d.]+)\s*<\/title>/.exec(html) || [])[1];
  if (!version) die('index.html: cannot find the version in <title>');

  let out = html;
  out = replaceOnce(out, '<!DOCTYPE html>\n',
    '<!DOCTYPE html>\n<!--\n' +
    '  GENERATED FILE — do not edit.\n\n' +
    '  Single-file build of Fractal Alps ' + version + ', produced from the modular\n' +
    '  source (index.html + css/style.css + ' + order.length + ' js/ modules) by build.js.\n' +
    '  Edit those and run `node build.js`. Anything changed here is lost on the\n' +
    '  next build, and never reaches anyone playing the modular build.\n-->\n',
    'doctype');
  out = replaceOnce(out, '<link rel="stylesheet" href="css/style.css">',
                    '<style>\n' + css + '\n</style>', 'stylesheet link');
  out = replaceOnce(out, 'var __ffModular = true;', 'var __ffModular = false;', 'watchdog flag');
  out = replaceOnce(out, '<script type="module" src="js/main.js"></script>',
                    '<script>\n(function () {\n\'use strict\';\n\n' + text.replace(/\n/g, '\n') + '\n})();\n</script>',
                    'module script tag');

  return { html: out, version, order };
}

// ------------------------------------------------------------------ driver

function artifactName(version) {
  return 'fractal-flight-' + version.replace(/\./g, '_') + '.html';
}

function checkModuleRefs() {
  const script = path.join(ROOT, 'test', 'check_module_refs.py');
  for (const py of ['python', 'python3']) {
    const r = spawnSync(py, [script], { encoding: 'utf8' });
    if (r.error) continue;
    if (r.status !== 0) {
      process.stdout.write(r.stdout || '');
      process.stderr.write(r.stderr || '');
      die('check_module_refs.py failed — fix the leak before building.\n' +
          '        A name used without importing it works in the single file and\n' +
          '        throws in the modular build; that is the freeze of 6 Sept 2026.');
    }
    return 'clean';
  }
  return 'SKIPPED — no python on PATH';
}

if (require.main === module) {
  const built = buildSingleFile();
  const name = artifactName(built.version);
  const out = path.join(ROOT, name);

  if (process.argv.includes('--check')) {
    if (!fs.existsSync(out)) die(name + ' is missing — run `node build.js`');
    const have = read(out);
    if (have !== built.html) die(name + ' is stale — run `node build.js`');
    console.log(name + ' is up to date');
  } else {
    console.log('module refs:  ' + checkModuleRefs());
    console.log('order:        ' + built.order.map(f => f.replace(/\.js$/, '')).join(' · '));
    fs.writeFileSync(out, built.html);
    console.log('wrote:        ' + name + '  (' + (Buffer.byteLength(built.html) / 1024).toFixed(0) + ' KB)');
  }
}

// RE_IMPORT is exported so test/test_smoke.js can replay the modules exactly
// the way the bundle does. Duplicating the regex there would be a second
// source of truth for how an import is recognised -- and it has to handle
// multi-line imports, which a naive /^import/ does not.
module.exports = { buildSingleFile, artifactName, RE_IMPORT, RE_LEFTOVER };
