#!/usr/bin/env python3
"""Local preview with byte ranges and optional, isolated measurement diagnostics.

Normal preview: python3 tools/preview.py --port 8766
Measured run:  --measure, then open /?measure=1&run=desktop-cold
Slow run:     --measure --latency-ms 150 --bandwidth-kbps 2000

Bandwidth is aggregate kilobits/second (1000 bits), shared by ALL local site
responses, not a separate allowance per connection. Latency is added before
response headers. Diagnostic JS/JSON are unthrottled and excluded from the
site-byte ledger. External resources (e.g. Google Fonts) are not throttled.
Use a separate port for each simultaneously open test page; otherwise run
serially and close the previous page first. Use a distinct run=LABEL for each
intentional run. Repeated HTML fetches/reloads with the same label reuse its
ledger (browser tooling may fetch HTML twice). /__measure-ledger?run=ID returns body
bytes successfully written to the socket, including incomplete responses. It
excludes HTTP headers and may include a small amount queued in the OS that the
browser has not consumed. It is NOT interchangeable with ResourceTiming's
completed-response transferSize (which includes response headers).
"""
import argparse
import html
import io
import json
import re
import threading
import time
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


class SharedThrottle:
    """Pace chunks through one lock so parallel media requests share the rate."""
    def __init__(self, bandwidth_kbps=0):
        self.bytes_per_second = bandwidth_kbps * 1000 / 8
        self.condition = threading.Condition()
        self.next_ticket = 0
        self.serving_ticket = 0

    def write(self, target, chunk):
        if not self.bytes_per_second:
            target.write(chunk)
            return
        # FIFO chunks prevent one video connection monopolizing the rate.
        # Other threads may queue while the current chunk is paced/written.
        with self.condition:
            ticket = self.next_ticket
            self.next_ticket += 1
            while ticket != self.serving_ticket:
                self.condition.wait()
        try:
            time.sleep(len(chunk) / self.bytes_per_second)
            target.write(chunk)
        finally:
            with self.condition:
                self.serving_ticket += 1
                self.condition.notify_all()


class Ledger:
    def __init__(self, label):
        self.label = label
        self.id = f'{label}-{uuid.uuid4().hex[:10]}'
        self.started = time.monotonic()
        self.requests = []
        self.lock = threading.Lock()

    def begin(self, path, method, byte_range, document):
        with self.lock:
            entry = {'id': len(self.requests) + 1, 'path': path, 'method': method,
                     'range': byte_range, 'document': document, 'startMs': self.elapsed(),
                     'status': None, 'expectedBodyBytes': None, 'bodyBytesWritten': 0,
                     'endMs': None, 'outcome': 'in-flight'}
            self.requests.append(entry)
            return entry

    def elapsed(self):
        return round((time.monotonic() - self.started) * 1000, 3)

    def update(self, entry, **values):
        with self.lock:
            entry.update(values)

    def wrote(self, entry, count):
        with self.lock:
            entry['bodyBytesWritten'] += count

    def finish(self, entry, aborted=False):
        with self.lock:
            if entry['endMs'] is not None:
                return
            entry['endMs'] = self.elapsed()
            entry['outcome'] = 'aborted' if aborted else 'complete'

    def snapshot(self, include_requests=True):
        with self.lock:
            entries = [dict(entry) for entry in self.requests]
            elapsed = self.elapsed()
        site = [entry for entry in entries if not entry['document']]
        return {'runId': self.id, 'elapsedMs': elapsed,
                'bodyBytesWritten': sum(entry['bodyBytesWritten'] for entry in entries),
                'siteBodyBytesWritten': sum(entry['bodyBytesWritten'] for entry in site),
                'siteRequests': len(site),
                'siteInFlight': sum(entry['outcome'] == 'in-flight' for entry in site),
                'siteCompleted': sum(entry['outcome'] == 'complete' for entry in site),
                'siteAborted': sum(entry['outcome'] == 'aborted' for entry in site),
                'requests': entries if include_requests else [entry for entry in entries if entry['outcome'] == 'in-flight'],
                'requestList': 'all' if include_requests else 'in-flight only',
                'definition': 'Response body bytes written to sockets; excludes headers and diagnostic endpoints. Site totals also exclude HTML. Includes in-flight/aborted body bytes; OS buffering can precede browser receipt.'}


class PreviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, handler, *, measure=False, latency_ms=0, bandwidth_kbps=0):
        super().__init__(address, handler)
        self.measure = measure
        self.latency_ms = latency_ms
        self.bandwidth_kbps = bandwidth_kbps
        self.throttle = SharedThrottle(bandwidth_kbps)
        self.ledger_lock = threading.Lock()
        self.ledgers = {}
        self.ledgers_by_label = {}
        self.begin_run('server')

    def begin_run(self, label):
        label = re.sub(r'[^a-zA-Z0-9_.-]', '-', label)[:64] or 'run'
        with self.ledger_lock:
            if label in self.ledgers_by_label:
                self.current_ledger = self.ledgers_by_label[label]
                return self.current_ledger
            ledger = Ledger(label)
            self.ledgers[ledger.id] = ledger
            self.ledgers_by_label[label] = ledger
            self.current_ledger = ledger
            while len(self.ledgers) > 30:
                old = self.ledgers.pop(next(iter(self.ledgers)))
                del self.ledgers_by_label[old.label]
        return ledger

    def ledger_for_request(self):
        # Subresources are assigned to the active serial run. Separate ports
        # are required for simultaneously open measurement pages.
        with self.ledger_lock:
            return self.current_ledger


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        self.record = None
        try:
            super().do_GET()
        finally:
            self.finish_record()

    def do_HEAD(self):
        self.record = None
        try:
            super().do_HEAD()
        finally:
            self.finish_record()

    def finish_record(self, aborted=False):
        if getattr(self, 'record', None) is not None:
            self.ledger.finish(self.record, aborted)

    def send_response(self, code, message=None):
        if getattr(self, 'record', None) is not None:
            self.ledger.update(self.record, status=code)
        super().send_response(code, message)

    def send_error(self, code, message=None, explain=None):
        # Route error bodies through the same byte ledger/throttle as files.
        short, long = self.responses.get(code, ('Error', 'Unspecified error'))
        data = (self.error_message_format % {'code': code, 'message': html.escape(message or short),
                                            'explain': html.escape(explain or long)}).encode('utf-8')
        body = self.content(data, self.error_content_type, code)
        if self.command != 'HEAD':
            self.copyfile(body, self.wfile)

    def send_head(self):
        self.remaining = None
        self.diagnostic = False
        parsed = urlsplit(self.path)
        query = parse_qs(parsed.query)
        if self.server.measure and parsed.path == '/__measure.js':
            self.diagnostic = True
            return self.content(Path(__file__).with_name('measure-performance.js').read_bytes(), 'text/javascript')
        if self.server.measure and parsed.path == '/__measure-ledger':
            self.diagnostic = True
            run_id = query.get('run', [''])[0]
            with self.server.ledger_lock:
                ledger = self.server.ledgers.get(run_id)
            if ledger is None:
                return self.content(json.dumps({'error': 'Unknown run ID'}).encode(), 'application/json', 404)
            result = ledger.snapshot(include_requests=query.get('detail') != ['0'])
            result['network'] = {'latencyMs': self.server.latency_ms,
                                 'aggregateBandwidthKbps': self.server.bandwidth_kbps}
            return self.content(json.dumps(result).encode(), 'application/json')
        measured = self.server.measure and parsed.path in ('/', '/index.html') and query.get('measure') == ['1']
        if measured:
            self.ledger = self.server.begin_run(query.get('run', ['run'])[0])
        else:
            self.ledger = self.server.ledger_for_request()
        if self.server.measure:
            self.record = self.ledger.begin(parsed.path, self.command, self.headers.get('Range'),
                                             parsed.path in ('/', '/index.html') or parsed.path.endswith('.html'))
        if self.server.latency_ms:
            time.sleep(self.server.latency_ms / 1000)
        if measured:
            run_id = self.ledger.id
            markup = f'<head><script src="/__measure.js?run={run_id}" data-run="{run_id}"></script>'
            data = (Path(self.directory) / 'index.html').read_text().replace('<head>', markup, 1).encode()
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
        if self.record is not None:
            self.ledger.update(self.record, expectedBodyBytes=self.remaining)
        stream.seek(first)
        self.send_response(status)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Content-Length', str(self.remaining))
        self.send_header('Accept-Ranges', 'bytes')
        if status == 206:
            self.send_header('Content-Range', f'bytes {first}-{last}/{size}')
        self.end_headers()
        return stream

    def content(self, data, kind, status=200):
        self.remaining = len(data)
        if getattr(self, 'record', None) is not None:
            self.ledger.update(self.record, expectedBodyBytes=len(data))
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        return io.BytesIO(data)

    def copyfile(self, source, target):
        remaining = self.remaining
        try:
            while remaining is None or remaining > 0:
                chunk = source.read(4096 if remaining is None else min(remaining, 4096))
                if not chunk:
                    break
                if self.diagnostic:
                    target.write(chunk)
                else:
                    self.server.throttle.write(target, chunk)
                if self.record is not None:
                    self.ledger.wrote(self.record, len(chunk))
                if remaining is not None:
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            self.finish_record(aborted=True)  # A browser cancelled a range request.


def nonnegative(value):
    value = float(value)
    if not 0 <= value < float('inf'):
        raise argparse.ArgumentTypeError('must be a finite, nonnegative number')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--measure', action='store_true', help='Enable /?measure=1&run=LABEL diagnostics and a server byte ledger')
    parser.add_argument('--latency-ms', type=nonnegative, default=0, help='Added latency before local site response headers; diagnostics exempt')
    parser.add_argument('--bandwidth-kbps', type=nonnegative, default=0, help='Aggregate local body bandwidth in decimal kilobits/second; 0 is unlimited')
    args = parser.parse_args()
    with PreviewServer(('127.0.0.1', args.port), partial(Handler, directory=str(args.root.resolve())),
                       measure=args.measure, latency_ms=args.latency_ms, bandwidth_kbps=args.bandwidth_kbps) as server:
        print(f'Local preview: http://127.0.0.1:{args.port}/', flush=True)
        if args.measure:
            print(f'Measurement: http://127.0.0.1:{args.port}/?measure=1&run=run', flush=True)
        if args.latency_ms or args.bandwidth_kbps:
            print(f'Network: {args.latency_ms:g} ms added latency; {args.bandwidth_kbps:g} kbps aggregate (0 = unlimited). External origins unaffected.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
