#!/usr/bin/env python3
"""HTTP regression checks for the local measurement server (stdlib only).

Run: python3 tools/validate_preview.py
Uses temporary files and an ephemeral loopback port. No browser, site edits,
external network, or persistent server is required. The shared-rate assertion
checks a lower bound rather than an exact speed, allowing normal host overhead.
"""
import json
import re
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from preview import Handler, PreviewServer


class QuietHandler(Handler):
    def log_message(self, *_args):
        pass


class PreviewMeasurements(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        (root / 'index.html').write_text('<html><head></head><body>Measurement fixture</body></html>')
        self.payload = bytes(range(256)) * 128
        (root / 'sample.mp4').write_bytes(self.payload)
        self.server = PreviewServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root)),
                                    measure=True, latency_ms=40, bandwidth_kbps=256)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def request(self, path, headers=None, method='GET'):
        request = Request(self.base + path, headers=headers or {}, method=method)
        try:
            response = urlopen(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def measure(self, label):
        status, headers, body = self.request('/?measure=1&run=' + label)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        match = re.search(rb'data-run="([^"]+)"', body)
        self.assertIsNotNone(match)
        return match[1].decode()

    def ledger(self, run, detail=1):
        status, _headers, body = self.request(f'/__measure-ledger?run={run}&detail={detail}')
        self.assertEqual(status, 200)
        return json.loads(body)

    def test_ranges_errors_headers_and_body_ledger(self):
        run = self.measure('ranges')
        start = time.monotonic()
        status, headers, body = self.request('/sample.mp4', {'Range': 'bytes=10-25'})
        self.assertGreaterEqual(time.monotonic() - start, .035, 'configured latency precedes response headers')
        self.assertEqual(status, 206)
        self.assertEqual(headers['Content-Range'], 'bytes 10-25/32768')
        self.assertEqual(headers['Content-Length'], '16')
        self.assertEqual(headers['Accept-Ranges'], 'bytes')
        self.assertEqual(body, self.payload[10:26])
        status, headers, body = self.request('/sample.mp4', {'Range': 'bytes=-17'})
        self.assertEqual(status, 206)
        self.assertEqual(body, self.payload[-17:])
        status, headers, body = self.request('/sample.mp4', {'Range': 'bytes=90000-'})
        self.assertEqual(status, 416)
        self.assertEqual(headers['Content-Range'], 'bytes */32768')
        self.assertEqual(headers['Content-Length'], '0')
        self.assertEqual(body, b'')
        status, headers, missing = self.request('/missing.mp4')
        self.assertEqual(status, 404)
        self.assertEqual(int(headers['Content-Length']), len(missing))
        self.assertIn('text/html', headers['Content-Type'])
        self.assertEqual(headers['Cache-Control'], 'no-store')
        status, headers, body = self.request('/sample.mp4', method='HEAD')
        self.assertEqual(status, 200)
        self.assertEqual(int(headers['Content-Length']), len(self.payload))
        self.assertEqual(body, b'')
        ledger = self.ledger(run)
        self.assertEqual(ledger['siteBodyBytesWritten'], 16 + 17 + len(missing))
        self.assertEqual(ledger['siteInFlight'], 0)
        records = ledger['requests']
        self.assertEqual(next(entry for entry in records if entry['path'] == '/missing.mp4')['status'], 404)
        head = next(entry for entry in records if entry['method'] == 'HEAD')
        self.assertEqual(head['bodyBytesWritten'], 0)
        self.assertEqual(head['expectedBodyBytes'], len(self.payload))

    def test_inflight_bytes_and_diagnostic_exclusion(self):
        run = self.measure('inflight')
        with urlopen(Request(self.base + '/sample.mp4', headers={'Range': 'bytes=0-16383'}), timeout=10) as response:
            first = response.read(4096)
            live = self.ledger(run, detail=0)
            self.assertEqual(live['siteInFlight'], 1)
            self.assertGreaterEqual(live['siteBodyBytesWritten'], 4096)
            self.assertLess(live['siteBodyBytesWritten'], 16384)
            self.assertEqual(live['requestList'], 'in-flight only')
            self.assertEqual(len(live['requests']), 1)
            self.assertEqual(first + response.read(), self.payload[:16384])
        self.assertEqual(self.ledger(run)['siteBodyBytesWritten'], 16384)
        status, _headers, script = self.request('/__measure.js?run=' + run)
        self.assertEqual(status, 200)
        self.assertIn(b'siteTransferBytes', script)
        final = self.ledger(run)
        self.assertEqual(final['siteBodyBytesWritten'], 16384)
        self.assertEqual(final['siteRequests'], 1, 'JS/ledger endpoints never enter site totals')
        self.assertEqual(self.ledger(run, detail=0)['requests'], [])

    def test_duplicate_html_label_keeps_subresources_in_same_run(self):
        run = self.measure('duplicate')
        self.request('/sample.mp4', {'Range': 'bytes=0-31'})
        self.assertEqual(self.measure('duplicate'), run, 'browser tooling may request the same HTML twice')
        self.request('/sample.mp4', {'Range': 'bytes=32-63'})
        self.assertEqual(self.ledger(run)['siteBodyBytesWritten'], 64)
        self.assertEqual(self.ledger(run)['siteRequests'], 2)
        new_run = self.measure('intentional-new-run')
        self.assertNotEqual(new_run, run)
        self.assertEqual(self.ledger(new_run)['siteBodyBytesWritten'], 0)
        self.request('/sample.mp4', {'Range': 'bytes=0-15'})
        self.assertEqual(self.ledger(new_run)['siteBodyBytesWritten'], 16)
        self.assertEqual(self.ledger(run)['siteBodyBytesWritten'], 64, 'distinct run leaves prior ledger unchanged')

    def test_parallel_requests_share_rate_without_starvation(self):
        run = self.measure('parallel')
        start = time.monotonic()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.request, '/sample.mp4') for _ in range(2)]
            # Both connections must make progress before either finishes. A
            # per-connection limiter or a monopolized shared lock would fail
            # the aggregate lower bound or the fair-progress assertion.
            progressing = []
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                progressing = [entry for entry in self.ledger(run)['requests'] if not entry['document']]
                if len(progressing) == 2 and all(entry['bodyBytesWritten'] > 0 for entry in progressing):
                    break
                time.sleep(.02)
            self.assertEqual(len(progressing), 2)
            self.assertTrue(all(0 < entry['bodyBytesWritten'] < len(self.payload) for entry in progressing), progressing)
            results = [future.result() for future in futures]
        elapsed = time.monotonic() - start
        self.assertTrue(all(status == 200 and body == self.payload for status, _headers, body in results))
        theoretical = 2 * len(self.payload) / (256 * 1000 / 8)
        self.assertGreaterEqual(elapsed, theoretical * .97, '256kbps is shared across connections, not multiplied')
        final = self.ledger(run)
        self.assertEqual(final['siteBodyBytesWritten'], 2 * len(self.payload))
        self.assertEqual(final['siteInFlight'], 0)
        self.assertEqual(final['siteCompleted'], 2)
        self.assertEqual(final['network'], {'latencyMs': 40, 'aggregateBandwidthKbps': 256})


if __name__ == '__main__':
    unittest.main(verbosity=2)
