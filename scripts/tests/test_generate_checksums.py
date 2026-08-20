"""Tests for release artifact checksum generation and verification."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from scripts.release.generate_checksums import verify_checksum, write_checksum


class GenerateChecksumsTests(unittest.TestCase):
    def test_round_trip_and_tamper_rejection(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            artifact = Path(temporary) / "installer.exe"
            artifact.write_bytes(b"unsigned release artifact")
            sidecar = write_checksum(artifact)

            self.assertRegex(sidecar.read_text(encoding="ascii"), r"^[0-9a-f]{64}  installer\.exe\n$")
            verify_checksum(sidecar)

            artifact.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "verification failed"):
                verify_checksum(sidecar)


if __name__ == "__main__":
    unittest.main()
