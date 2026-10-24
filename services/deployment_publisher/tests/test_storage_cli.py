"""Exercise the actual AWS CLI boundary against a loopback-only S3 fixture"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from urllib.parse import unquote

PUBLISHER = os.environ.get("PANDD_PUBLISHER", "pandd-publisher")


@unittest.skipUnless(shutil.which("aws"), "AWS CLI is required for the local S3 protocol test")
class StorageCliTests(unittest.TestCase):
    """Verify real command arguments, remote verification, and error classification"""

    def test_upload_then_pointer_promotion_and_remote_access_failure(self):
        """Publish through a real CLI and ensure a 403 cannot become an overwrite"""
        objects = {}
        writes = []
        deny = False

        class Handler(BaseHTTPRequestHandler):
            """Implement the small S3 surface needed for upload integrity checks"""

            def do_HEAD(self):
                """Serve immutable object metadata or an explicit storage error"""
                if deny:
                    self.send_response(403)
                    self.end_headers()
                    return
                entry = objects.get(unquote(self.path))
                if entry is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                body, content_type, digest = entry
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Content-Type", content_type)
                self.send_header("x-amz-meta-sha256", digest)
                self.send_header("ETag", '"fixture"')
                self.end_headers()

            def do_PUT(self):
                """Store uploaded bytes and metadata for the subsequent HEAD verification"""
                body = self.rfile.read(int(self.headers["Content-Length"]))
                key = unquote(self.path)
                objects[key] = (body, self.headers["Content-Type"], self.headers["x-amz-meta-sha256"])
                writes.append(key)
                self.send_response(200)
                self.send_header("ETag", '"fixture"')
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *_):
                """Keep the local fixture quiet"""

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                keys = ["v1/blobs/sha256/blob", "v1/catalog/ja-JP/windows/x86_64.json",
                        "v1/games/sample/releases/windows/x86_64/latest.json"]
                for key in keys:
                    path = root / "public" / key
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b"fixture")
                environment = dict(os.environ, AWS_ACCESS_KEY_ID="local-fixture", AWS_SECRET_ACCESS_KEY="local-fixture",
                                   AWS_DEFAULT_REGION="us-east-1", AWS_EC2_METADATA_DISABLED="true",
                                   AWS_CONFIG_FILE=str(root / "no-config"), AWS_SHARED_CREDENTIALS_FILE=str(root / "no-credentials"),
                                   AWS_MAX_ATTEMPTS="1")
                arguments = ["--output", str(root / "public"), "--endpoint", f"http://127.0.0.1:{server.server_port}", "--bucket", "fixture"]
                for operation, count in [("upload-immutable", 1), ("promote-pointers", 3)]:
                    result = subprocess.run([PUBLISHER, operation, *arguments], capture_output=True, text=True, env=environment)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(len(writes), count)
                self.assertEqual(writes, [f"/fixture/{key}" for key in keys])
                deny = True
                result = subprocess.run([PUBLISHER, "upload", *arguments], capture_output=True, text=True, env=environment)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("cannot inspect remote object", result.stderr)
                self.assertEqual(len(writes), 3)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
