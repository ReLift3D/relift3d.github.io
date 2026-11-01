#!/usr/bin/env python3
"""Serve a local preview with MP4 byte ranges. Never contacts a remote service."""
import argparse
import io
import re
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_head(self):
        self.remaining = None
        if self.path == '/__measure.js' and self.server.measure:
            data = Path(__file__).with_name('measure-performance.js').read_bytes()
            return self.content(data, 'text/javascript')
        if self.path == '/?measure=1' and self.server.measure:
            data = (Path(self.directory) / 'index.html').read_text().replace(
                '<head>', '<head><script src="/__measure.js"></script>').encode()
            return self.content(data, 'text/html')
        path = Path(self.translate_path(self.path))
        if not path.is_file():
            return super().send_head()
        try:
            stream = path.open('rb')
        except OSError:
            self.send_error(404)
            return None
        size = path.stat().st_size
        header = self.headers.get('Range', '')
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', header)
        first, last, status = 0, size - 1, 200
        if match and any(match.groups()):
            if match[1]:
                first = int(match[1])
                last = min(int(match[2]), size - 1) if match[2] else size - 1
            else:
                first = max(0, size - int(match[2]))
            if first > last or first >= size:
                stream.close()
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return None
            status = 206
        self.remaining = last - first + 1
        stream.seek(first)
        self.send_response(status)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Content-Length', str(self.remaining))
        self.send_header('Accept-Ranges', 'bytes')
        if status == 206:
            self.send_header('Content-Range', f'bytes {first}-{last}/{size}')
        self.end_headers()
        return stream

    def content(self, data, kind):
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        return io.BytesIO(data)

    def copyfile(self, source, target):
        try:
            if self.remaining is None:
                shutil.copyfileobj(source, target)
            else:
                remaining = self.remaining
                while remaining:
                    chunk = source.read(min(remaining, 1024 * 1024))
                    if not chunk:
                        break
                    target.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Browsers cancel range requests when scrolling away.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--measure', action='store_true', help='Enable optional /?measure=1 diagnostic page')
    args = parser.parse_args()
    with ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(args.root.resolve()))) as server:
        server.measure = args.measure
        print(f'Local preview: http://127.0.0.1:{args.port}/', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
