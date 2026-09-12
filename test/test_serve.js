// serve.py actually serves, over the address the docs tell people to use.
//
// Why this exists (12 Sept 2026). `python serve.py 8734` printed a healthy
// "Serving HTTP on :: port 8734" and then REFUSED every connection to
// http://127.0.0.1:8734/ -- the URL in CLAUDE.md, in the ROADMAP's Chrome
// command, and the one Nico typed. Chrome said "site can't be reached" while
// the server sat there looking fine.
//
// With no bind argument the stdlib picks the IPv6 wildcard, and on Windows
// IPV6_V6ONLY defaults to 1, so the socket is IPv6-ONLY: [::1] and localhost
// work, 127.0.0.1 does not. `python -m http.server` escapes this by clearing
// that option in a DualStackServerMixin -- which the stdlib defines INSIDE its
// own `__main__` block, so serve.py's `http.server.test()` call never got it,
// despite serve.py's docstring claiming to be exactly that plus one header.
// On Linux IPV6_V6ONLY already defaults to 0, which is why it stayed hidden.
//
// Nothing else in the suite touches serve.py: it is the one piece of the
// project that only fails when a real socket is opened.

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const { check, eq, ok, summary } = require('./harness');

const root = path.join(__dirname, '..');

const PY = ['python', 'python3', 'py'].find(exe => {
  const r = spawnSync(exe, ['-c', 'print(1)'], { encoding: 'utf8' });
  return r.status === 0;
});
if (!PY) {
  console.log('serve\n  SKIPPED — no python on PATH.');
  process.exit(0);
}

// A port nobody else is on, so a dev server already running on 8734 (Nico
// usually has one) cannot make this pass or fail for the wrong reason.
const PORT = 8000 + Math.floor(Math.random() * 900) + 100;

function get(host, urlPath) {
  return new Promise(resolve => {
    const req = http.get({ host, port: PORT, path: urlPath, family: host.includes(':') ? 6 : 4 },
      res => {
        res.resume();
        resolve({ status: res.statusCode, headers: res.headers });
      });
    req.on('error', e => resolve({ error: e.code || String(e) }));
    req.setTimeout(4000, () => { req.destroy(); resolve({ error: 'TIMEOUT' }); });
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function withServer(fn) {
  const srv = spawn(PY, ['serve.py', String(PORT)], { cwd: root, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) {                 // up to ~4 s for the bind
      const r = await get('127.0.0.1', '/index.html');
      const r6 = r.error ? await get('::1', '/index.html') : null;
      if (!r.error || (r6 && !r6.error)) break;    // listening on SOMETHING
      await wait(100);
    }
    await fn();
  } finally {
    srv.kill();
  }
}

console.log('serve');

let results = {};
const ready = withServer(async () => {
  results.v4 = await get('127.0.0.1', '/index.html');
  results.v6 = await get('::1', '/index.html');
  results.js = await get('127.0.0.1', '/js/main.js');
});

ready.then(() => {
  // THE REGRESSION. Everything else here was already working when this broke.
  check('IPv4 127.0.0.1 is reachable — the address the docs tell you to use', () => {
    ok(!results.v4.error,
       'connecting to 127.0.0.1 failed with ' + results.v4.error +
       '. serve.py is bound IPv6-only again: give the server a ServerClass that ' +
       'clears IPV6_V6ONLY (see DualStackServer in serve.py).');
    eq(results.v4.status, 200, 'index.html over IPv4');
  });

  check('IPv6 ::1 keeps working — the fix must add IPv4, not swap to it', () => {
    ok(!results.v6.error, 'connecting to ::1 failed with ' + results.v6.error);
    eq(results.v6.status, 200, 'index.html over IPv6');
  });

  // The two reasons serve.py exists at all, which a rewrite of the bind could
  // easily drop. Both fail SILENTLY in the browser: a stale module looks like
  // an edit that did nothing, and text/plain makes the page load and sit there.
  check('modules are sent no-store, or an edited file looks unchanged', () => {
    const cc = results.js.headers && results.js.headers['cache-control'];
    ok(cc && /no-store/.test(cc), 'Cache-Control was ' + cc);
  });

  check('modules are sent as JavaScript, or the strict MIME check refuses them', () => {
    const ct = results.js.headers && results.js.headers['content-type'];
    ok(ct && /javascript/.test(ct),
       'Content-Type was ' + ct + '; a module served as text/plain is REFUSED');
  });

  process.exitCode = summary('serve') ? 1 : 0;
});
