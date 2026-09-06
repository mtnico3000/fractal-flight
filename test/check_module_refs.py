#!/usr/bin/env python3
"""Catch cross-module references that only work in the SINGLE-FILE build.

The modular build is ES modules (every name must be imported); the single file
is plain concatenated script text (everything is one global scope). So a name
another module exports can be referenced with no import, work perfectly in the
single file, and throw ReferenceError in the modular one — in whatever rare
branch happens to touch it.

That is not hypothetical. `js/fx.js` referenced `camPos` without importing it,
inside the `kind === 3` bomb-blast-ring branch. The single-file build was fine.
The modular build threw on the first bomb that reached the ground, and because
frame() reschedules itself on its LAST line with no try/catch, the loop was
never rescheduled: the world froze permanently while the audio thread played
on. It survived since at least v8.0 because the single file is the one people
double-click and play.

    python test/check_module_refs.py     # exit 1 if any leak is found

Comments and string/template literals are stripped first, or shaders.js — one
enormous GLSL template — reports every GLSL identifier as a leak.
"""
import glob
import os
import re
import sys


def strip_comments_and_strings(src):
    """Blank out //, /* */, '...', "..." and `...` so only real code remains."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        two = src[i:i + 2]
        if two == '//':
            j = src.find('\n', i)
            j = n if j < 0 else j
            out.append('\n' * src.count('\n', i, j))
            i = j
        elif two == '/*':
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append('\n' * src.count('\n', i, j))
            i = j
        elif c in '\'"`':
            quote, j = c, i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == quote:
                    j += 1
                    break
                j += 1
            out.append('\n' * src.count('\n', i, j))
            i = j
        else:
            out.append(c)
            i += 1
    return ''.join(out)


DECL = re.compile(r'(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)')
EXPORT = re.compile(r'^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)', re.M)
IMPORT = re.compile(r'^import\s*\{([^}]*)\}', re.M)


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    files = sorted(glob.glob(os.path.join(root, 'js', '*.js')))
    if not files:
        print('no js/*.js found')
        return 1

    exports = {}
    for path in files:
        src = open(path, encoding='utf-8').read()
        for name in EXPORT.findall(strip_comments_and_strings(src)):
            exports[name] = os.path.basename(path)

    leaks = []
    for path in files:
        base = os.path.basename(path)
        raw = open(path, encoding='utf-8').read()
        code = strip_comments_and_strings(raw)

        imported = set()
        for group in IMPORT.findall(code):
            for part in group.split(','):
                imported.add(part.strip().split(' as ')[-1].strip())
        # function parameters shadow module names legitimately (drawTrail(camB, ...))
        params = set()
        for sig in re.findall(r'(?:function\s*[\w$]*\s*)?\(([^()]*)\)\s*(?:=>|\{)', code):
            for part in sig.split(','):
                params.add(part.strip().split('=')[0].strip())
        local = set(DECL.findall(code)) | params

        body = IMPORT.sub('', code)
        for name, home in exports.items():
            if home == base or name in imported or name in local:
                continue
            hit = re.search(r'(?<![\w$.])' + re.escape(name) + r'(?![\w$])', body)
            if hit:
                leaks.append((base, name, home, body[:hit.start()].count('\n') + 1))

    for base, name, home, line in leaks:
        print('LEAK  js/%s:%d  uses %r (exported by %s) without importing it'
              % (base, line, name, home))
    print()
    print('%d module(s) scanned, %d leak(s)' % (len(files), len(leaks)))
    return 1 if leaks else 0


if __name__ == '__main__':
    sys.exit(main())
