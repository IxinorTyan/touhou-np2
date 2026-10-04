"""Local-only static server. No third-party packages required."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import socket
from urllib.parse import unquote, urlsplit
import webbrowser

ROOT = Path(__file__).resolve().parent

class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.wasm': 'application/wasm',
                      '.gz': 'application/octet-stream'}

    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        parts = Path(path).parts
        allowed = {'index.html', 'player.html', 'app.js', 'player.js', 'disk-images.js', 'style.css',
                   'vendor', 'disks'}
        relative = path.lstrip('/')
        if path != '/' and (relative.split('/')[0] not in allowed or
                            any(p.startswith('.') for p in parts) or '\\' in path):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=9861)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    required = ['index.html', 'disk-images.js', 'vendor/np2/np21.wasm', 'vendor/np2/np21.js',
                'vendor/np2/np2-wasm.js', 'vendor/np2/font.bmp', 'vendor/np2/font_cn.bmp', 'disks/manifest.json',
                *[f'disks/{game}-{lang}.hdi.gz' for game in range(1, 6)
                  for lang in ('jp', 'cn') if game != 1 or lang == 'jp']]
    for item in required:
        if not (ROOT / item).is_file():
            raise SystemExit(f'Missing file: {item}')
    # Try adjacent ports if another application owns the preferred one.
    for port in range(args.port, args.port + 20):
        try:
            server = LocalServer(('127.0.0.1', port), partial(Handler, directory=str(ROOT)))
            break
        except OSError as error:
            if error.errno not in (98, 10048):
                raise
    else:
        raise SystemExit('No free port. Close an old server window and retry.')
    url = f'http://127.0.0.1:{port}/'
    print(f'\nTouhou PC-98 / NP2 Web\n{url}\nKeep this window open. Press Ctrl+C to stop.\n', flush=True)
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
