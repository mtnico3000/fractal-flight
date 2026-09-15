// Load a REAL js/ module into a plain function scope with stubbed imports.
//
// This is the pattern the Cowork sessions used and CLAUDE.md documents: strip
// the `import` lines, strip the `export ` keyword, then evaluate the rest in a
// Function whose parameters are the stubs. It tests the shipped source rather
// than a copy of it, and needs no bundler, no npm and no browser — which is
// the whole point for a project with neither.
//
// `extra` exposes names the module does NOT export (HP_MOTHER, hullAlive),
// because the interesting invariants are usually the private ones.

const fs = require('fs');
const path = require('path');
// Reuse build.js's OWN import regex rather than a line filter. A naive
// /^import/ drops the first line of a multi-line import and leaves the rest
// behind as a syntax error -- the trap CLAUDE.md names, and the reason
// test_smoke.js already borrows this same expression.
const { RE_IMPORT } = require('../build.js');

function loadModule(file, stubs = {}, extra = []) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  const body = src
    .replace(new RegExp(RE_IMPORT.source, RE_IMPORT.flags), '')
    .replace(/^export\s+/gm, '');

  const exported = [...src.matchAll(/^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)]
    .map(m => m[1]);
  const names = [...new Set([...exported, ...extra])];
  const stubNames = Object.keys(stubs);

  const fn = new Function(...stubNames, body + '\nreturn {' + names.join(',') + '};');
  return fn(...stubNames.map(n => stubs[n]));
}

// --- the tiniest possible assertion kit -------------------------------------

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failures.push(name + ' — ' + e.message);
    console.log('  FAIL ' + name + '\n         ' + e.message);
  }
}

function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what || 'value') + ': expected ' + JSON.stringify(expected) +
                    ', got ' + JSON.stringify(actual));
  }
}

function ok(cond, what) {
  if (!cond) throw new Error(what || 'expected truthy');
}

function summary(label) {
  console.log('\n' + label + ': ' + passed + ' passed, ' + failures.length + ' failed');
  return failures.length;
}

module.exports = { loadModule, check, eq, ok, summary };
