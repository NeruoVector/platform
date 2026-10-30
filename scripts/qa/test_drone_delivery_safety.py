"""The delivery harness must refuse unsafe targets before contacting any service."""
import http.server
import os
import pathlib
import subprocess
import tempfile
import threading
import unittest

HARNESS = pathlib.Path(__file__).with_name('drone_delivery.py')


class Recorder(http.server.BaseHTTPRequestHandler):
    writes = 0

    def do_POST(self):
        type(self).writes += 1
        self.send_response(400)
        self.end_headers()
        self.wfile.write(b'{}')

    def log_message(self, *_args):
        pass


class TargetSafetyTests(unittest.TestCase):
    def test_unsafe_targets_are_rejected_before_http_or_docker(self):
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Recorder)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        with tempfile.TemporaryDirectory() as directory:
            marker = pathlib.Path(directory) / 'docker-called'
            docker = pathlib.Path(directory) / 'docker'
            docker.write_text(f'#!/bin/sh\ntouch "{marker}"\nexit 1\n')
            docker.chmod(0o755)
            env = os.environ.copy()
            env.update({
                'PATH': directory + os.pathsep + env['PATH'],
                'QA_API': f'http://127.0.0.1:{server.server_port}',
                'QA_PG_CONTAINER': 'qa-telemetry-test-pg',
                'QA_PG_DATABASE': 'qa_telemetry_test',
                'QA_REDIS_CONTAINER': 'qa-telemetry-test-redis',
                'QA_NATIVE_CLI': '/tmp/test-native',
                'QA_ADMIN_USER': 'synthetic', 'QA_ADMIN_PASSWORD': 'synthetic',
                'QA_DISPOSABLE': 'yes',
            })
            cases = [
                {'QA_PG_CONTAINER': 'nv-postgres', 'QA_PG_DATABASE': 'neurovector'},
                {'QA_API': 'http://production.example:8085'},
                {'QA_DISPOSABLE': 'no'},
                {'QA_REDIS_CONTAINER': 'nv-redis'},
                {'QA_API': 'http://127.0.0.1:8081'},
                {'QA_PG_DATABASE': 'qa_telemetry_production'},
            ]
            for overrides in cases:
                with self.subTest(overrides=overrides):
                    Recorder.writes = 0
                    result = subprocess.run(['python3', str(HARNESS)], env=env | overrides,
                                            capture_output=True, text=True, timeout=10)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(Recorder.writes, 0)
                    self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main()
