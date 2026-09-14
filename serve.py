#!/usr/bin/env python3
"""Dev server for the modular build: python -m http.server, plus one header.

`python -m http.server` sends NO Cache-Control at all, so browsers apply
heuristic freshness to js/*.js and css/style.css — a normal refresh replays the
modules already in cache instead of revalidating. Editing a module and
reloading then appears to do nothing at all, which is an expensive way to lose
an hour: on 6 Sept 2026 a lowered mothership bomb count was live in the file,
correct in the code, and simply not in the page. `no-store` makes every reload
fetch the real file.

    python serve.py            # port 8734, all interfaces (as http.server does)
    python serve.py 8734 --debug     # ... plus the debug build (see below)
    python serve.py 8080       # another port
    python serve.py 8734 127.0.0.1   # localhost only

The .js mapping is deliberate insurance, not decoration: on Windows mimetypes
reads the registry, where HKCR\\.js can be text/plain — and a module served as
text/plain is REFUSED by the browser's strict MIME check, so the page loads and
silently does nothing.

The DualStackServer below is the same insurance for the ADDRESS. With no bind
argument the stdlib picks the IPv6 wildcard and announces "Serving HTTP on ::",
and on Windows IPV6_V6ONLY defaults to 1 — so the socket is IPv6-ONLY and every
connection to 127.0.0.1 is refused while [::1] and localhost work. The server
looks perfectly healthy and the browser says the site cannot be reached.
`python -m http.server` does not have this problem because it clears that
option in a DualStackServerMixin — which the stdlib defines INSIDE its own
`__main__` block, so calling `http.server.test()` from a script like this one
never gets it. On Linux the default is already 0, which is why this stayed
hidden until someone opened http://127.0.0.1:8734/ on Windows (12 Sept 2026).
A --debug run serves ONE file differently: js/dbgflag.js comes back as
`export const DEBUG_BUILD = true;` instead of the `false` on disk. That single
flag is what makes main.js dynamically import js/debug.js, which carries the
knob table, the Debug panel and the shader's false-colour channels. Nothing
else in the game reaches for any of it, so a normal run has no debug code in
the page and no false-colour channels in the shader -- worth about half the
driver compile (docs/COMPILE.md). The file on disk is never modified, so the
artifact build and git are unaffected by however the server was started.
"""
import contextlib
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer, test


class DualStackServer(ThreadingHTTPServer):
    """Accept IPv4 on the IPv6 wildcard socket, as `python -m http.server` does."""

    def server_bind(self):
        # Suppressed rather than guarded: the option does not exist on an IPv4
        # socket, which is the case the moment someone passes a bind address.
        with contextlib.suppress(Exception):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        return super().server_bind()


DEBUG_FLAG_PATH = '/js/dbgflag.js'
DEBUG_FLAG_BODY = b'// served by serve.py --debug\nexport const DEBUG_BUILD = true;\n'


class NoStoreHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
    }

    debug_build = False

    def send_head(self):
        # The one interception: hand back a true DEBUG_BUILD without touching
        # the file on disk, so `git status` stays clean whatever the server
        # was started with.
        if self.debug_build and self.path.split('?')[0] == DEBUG_FLAG_PATH:
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Content-Length', str(len(DEBUG_FLAG_BODY)))
            self.end_headers()
            import io
            return io.BytesIO(DEBUG_FLAG_BODY)
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a not in ('--debug', '-debug')]
    debug = len(args) != len(sys.argv) - 1
    port = int(args[0]) if len(args) > 0 else 8734
    bind = args[1] if len(args) > 1 else None
    NoStoreHandler.debug_build = debug
    if debug:
        print('DEBUG BUILD: serving js/dbgflag.js as true -- Debug panel and false-colour channels ON (slower shader compile)')
    test(HandlerClass=NoStoreHandler, ServerClass=DualStackServer,
         port=port, bind=bind)
