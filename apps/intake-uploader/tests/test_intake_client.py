"""Unit tests for the desktop intake transport boundary."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from pandd_intake_uploader.application import CancellationToken, ValidationError
from pandd_intake_uploader.intake_client import IntakeClient


class IntakeClientTests(unittest.TestCase):
    def descriptor(self, root: Path, content: bytes = b"artifact") -> Path:
        archive = root / "fixture.zip"
        archive.write_bytes(content)
        descriptor = root / "fixture.pandd-artifact.json"
        descriptor.write_text(json.dumps({
            "schemaVersion": 1,
            "artifactId": "12345678-1234-4123-8123-123456789abc",
            "artifactFile": archive.name,
            "gameId": "sample-game",
            "version": "1.0.0",
            "platform": "windows",
            "arch": "x86_64",
            "sizeBytes": len(content),
            "fileCount": 1,
            "sha256": hashlib.sha256(content).hexdigest(),
            "createdAt": "2026-08-13T00:00:00Z",
        }), encoding="utf-8")
        return descriptor

    def test_rejects_changed_archive_before_authentication(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            descriptor = self.descriptor(Path(temporary))
            (descriptor.parent / "fixture.zip").write_bytes(b"ARTIFACT")
            client = IntakeClient("http://localhost:3000")
            with mock.patch.object(client, "_authenticate") as authenticate, \
                    self.assertRaisesRegex(ValidationError, "SHA-256"):
                client.upload(descriptor, lambda *_: None, CancellationToken())
            authenticate.assert_not_called()

    def test_resume_skips_recorded_parts_and_seals(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            descriptor = self.descriptor(Path(temporary))
            client = IntakeClient("http://localhost:3000")
            responses = [
                {
                    "partSize": 4,
                    "partCount": 2,
                    "uploadedParts": [1],
                    "state": "uploading",
                },
                {
                    "transport": "worker-proxy",
                    "parts": [{"partNumber": 2, "url": "http://localhost/part/2"}],
                },
                {"state": "sealed"},
            ]
            with mock.patch.object(client, "_authenticate", return_value="token"), \
                    mock.patch.object(client, "_json_request", side_effect=responses) as request, \
                    mock.patch.object(client, "_upload_part", return_value=("etag", 4)) as upload:
                client.upload(descriptor, lambda *_: None, CancellationToken())
            upload.assert_called_once()
            self.assertEqual(upload.call_args.args[1], 2)
            self.assertIn("/seal", request.call_args_list[-1].args[1])


if __name__ == "__main__":
    unittest.main()
