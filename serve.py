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
    python serve.py 8080       # another port
    python serve.py 8734 127.0.0.1   # localhost only

The .js mapping is deliberate insurance, not decoration: on Windows mimetypes
reads the registry, where HKCR\\.js can be text/plain — and a module served as
text/plain is REFUSED by the browser's strict MIME check, so the page loads and
silently does nothing.
"""
import sys
from http.server import SimpleHTTPRequestHandler, test


class NoStoreHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8734
    bind = sys.argv[2] if len(sys.argv) > 2 else None
    test(HandlerClass=NoStoreHandler, port=port, bind=bind)
