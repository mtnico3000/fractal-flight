// The shader as CODE, not as text.  (ROADMAP C2, landed 10 Sept 2026)
//
// Everything in test_shader.js is a regex over source text, and regexes have
// already been fooled twice here: a fixed-width window read past the end of the
// function it was checking, and a whole-file scan was answered by a second copy
// of the same maths in terrainCheapH(). An AST cannot make either mistake.
//
// This file needs `npm install` (@shaderfrog/glsl-parser). That is dev-only
// tooling and does not touch the game: test_build.js still requires the shipped
// artifact to fetch nothing, because it runs from a double-clicked file:// page.
// run_tests.js skips this suite with a note if node_modules is absent, so a
// fresh clone stays runnable with no npm at all.
//
// What it buys that the regexes could not:
//   1. a SYNTAX gate that does not cost an 80 s driver compile to trip;
//   2. a TYPO gate -- the parser reports every name used but never declared,
//      so a misspelled function call fails here instead of silently compiling
//      to nothing or blowing up in the browser;
//   3. a MEASURED uniform budget, replacing a hand-waved "~260 slots".

const fs = require('fs');
const path = require('path');
const { check, eq, ok, summary } = require('./harness');

// Dev-only dependency. A fresh clone must still be able to run everything
// else, so this suite reports itself skipped rather than exploding.
let parser;
try {
  ({ parser } = require('@shaderfrog/glsl-parser'));
} catch {
  console.log('glsl\n  SKIPPED — needs `npm install` (@shaderfrog/glsl-parser).\n' +
              '         Dev tooling only; the game itself has no dependencies.');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'shaders.js'), 'utf8').replace(/\r\n/g, '\n');

// Pull a template literal out of shaders.js. Safe because test_shader.js pins
// the backtick count at exactly 4 -- two delimiters per shader, none stray.
function shaderSource(name) {
  const a = src.indexOf('export const ' + name + ' = `');
  ok(a >= 0, name + ' not found in shaders.js');
  const s = src.indexOf('`', a) + 1;
  const e = src.indexOf('`', s);
  ok(e > s, name + ': unterminated template literal');
  return src.slice(s, e);
}

// The parser reports unresolved names through console.warn rather than
// throwing, so they have to be captured to be asserted on.
function parseCapturing(source, what) {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  let ast, err = null;
  try {
    ast = parser.parse(source);
  } catch (e) {
    err = e;
  } finally {
    console.warn = orig;
  }
  if (err) {
    const where = err.location ? ' at line ' + err.location.start.line : '';
    throw new Error(what + ' failed to parse' + where + ': ' + err.message);
  }
  return { ast, warnings };
}

console.log('glsl');

const vs = shaderSource('vsSrc');
const fsrc = shaderSource('fsSrc');

check('both shaders parse as GLSL', () => {
  const v = parseCapturing(vs, 'vsSrc');
  const f = parseCapturing(fsrc, 'fsSrc');
  ok(v.ast.program.length > 0, 'vsSrc parsed to an empty program');
  ok(f.ast.program.length > 50,
     'fsSrc parsed to only ' + f.ast.program.length + ' top-level statements — ' +
     'the template probably got truncated');
});

// Every name the parser cannot resolve. The two macros are expected: BDE and
// SDE are function-like #defines, which a parser without a preprocessor pass
// cannot see. gl_FragCoord is a built-in it does not model. ANYTHING ELSE here
// is a typo that would otherwise surface as a driver compile error 80 s into a
// page load, or worse, as a silently wrong pixel.
const KNOWN_UNRESOLVED = ['BDE', 'SDE', 'gl_FragCoord'];

check('no unresolved names beyond the known macros', () => {
  const { warnings } = parseCapturing(fsrc, 'fsSrc');
  const names = warnings
    .map(w => (/"([^"]+)"/.exec(w) || [])[1] || w)
    .filter(n => !KNOWN_UNRESOLVED.includes(n));
  ok(names.length === 0,
     'unresolved in fsSrc: ' + names.join(', ') +
     '\n         (a misspelled call, or a new function-like #define — if the ' +
     'latter, add it to KNOWN_UNRESOLVED)');
});

check('the known macros are still there to be known about', () => {
  // Guards the exception list itself: if BDE/SDE get inlined away, the list is
  // stale and would hide a real typo of the same name later.
  for (const m of ['BDE', 'SDE']) {
    ok(new RegExp('#define\\s+' + m + '\\s*\\(').test(fsrc),
       m + ' is on the unresolved-name exception list but is no longer a ' +
       'function-like #define — drop it from KNOWN_UNRESOLVED');
  }
});

// --- the uniform budget, measured --------------------------------------------
// CLAUDE.md carried "~260 vec4 slots used" as an estimate for months. The real
// number is countable, and the reason to care is exact: GLSL ES 3.0 guarantees
// only 224 fragment uniform vectors, so anything above that may fail to LINK on
// the weakest target (jul's phone) while working fine on every desktop.
const SLOTS = {
  float: 1, int: 1, uint: 1, bool: 1,
  vec2: 1, vec3: 1, vec4: 1,
  ivec2: 1, ivec3: 1, ivec4: 1, bvec2: 1, bvec3: 1, bvec4: 1,
  mat2: 2, mat3: 3, mat4: 4,
  mat2x2: 2, mat2x3: 2, mat2x4: 2,
  mat3x2: 3, mat3x3: 3, mat3x4: 3,
  mat4x2: 4, mat4x3: 4, mat4x4: 4,
  // opaque types are not counted against the vector budget
  sampler2D: 0, sampler3D: 0, samplerCube: 0,
  isampler2D: 0, usampler2D: 0, sampler2DShadow: 0,
};

function uniformSlots(source) {
  const { ast } = parseCapturing(source, 'fsSrc');
  const rows = [];
  let total = 0;
  for (const node of ast.program) {
    if (node.type !== 'declaration_statement') continue;
    const dl = node.declaration;
    if (!dl || dl.type !== 'declarator_list') continue;
    const quals = (dl.specified_type && dl.specified_type.qualifiers) || [];
    if (!quals.some(q => q.token === 'uniform')) continue;
    const type = dl.specified_type.specifier.specifier.token;
    for (const dec of dl.declarations) {
      let count = 1;
      const q = dec.quantifier;
      if (Array.isArray(q) && q.length && q[0].expression &&
          q[0].expression.type === 'int_constant') {
        count = Number(q[0].expression.token);
      }
      const per = SLOTS[type];
      ok(per !== undefined, 'unknown uniform type "' + type + '" — add it to SLOTS');
      total += per * count;
      rows.push({ name: dec.identifier.identifier, type, count, slots: per * count });
    }
  }
  return { total, rows };
}

const MOBILE_MIN = 224;    // the GLSL ES 3.0 guaranteed minimum
const CEILING = 260;       // headroom over today's count; raising it is a decision

check('the fragment uniform budget is under its ceiling', () => {
  const { total, rows } = uniformSlots(fsrc);
  const top = rows.slice().sort((a, b) => b.slots - a.slots).slice(0, 5)
    .map(r => r.name + '[' + r.count + ']=' + r.slots).join(', ');
  ok(total <= CEILING,
     'fragment uniforms use ' + total + ' vec4 slots, over the ' + CEILING +
     ' ceiling. Biggest: ' + top + '. Pack alien/fx data into a texture, or ' +
     'raise CEILING deliberately.');
  console.log('  note  fragment uniforms: ' + total + ' vec4 slots (ceiling ' + CEILING +
              ', GLSL ES 3.0 guarantees only ' + MOBILE_MIN + ')');
  console.log('         biggest: ' + top);
  if (total > MOBILE_MIN) {
    console.log('  note  above the ' + MOBILE_MIN + '-slot mobile minimum — may fail to LINK');
    console.log('         on the weakest target. Desktop is unaffected. (ROADMAP C3)');
  }
});

process.exitCode = summary('glsl') ? 1 : 0;
