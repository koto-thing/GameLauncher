"""Tests for fail-closed license text collection."""

from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from scripts.release import collect_licenses


class LicenseCollectorTests(unittest.TestCase):
    """Verify release text pins cannot be bypassed by changed vendored bytes."""

    def test_read_verified_accepts_only_the_pinned_hash(self) -> None:
        """Matching bytes pass while any vendored mutation fails closed."""
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "license.txt"
            content = b"license text"
            source.write_bytes(content)
            digest = hashlib.sha256(content).hexdigest()
            self.assertEqual(collect_licenses.read_verified(source, digest), content)
            source.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "license hash changed"):
                collect_licenses.read_verified(source, digest)

    def test_vendored_sources_match_all_pinned_hashes(self) -> None:
        """Every source shipped by the repository must match its reviewed pin."""
        for name, digest in collect_licenses.LICENSE_SOURCES.items():
            collect_licenses.read_verified(collect_licenses.SOURCE_DIRECTORY / name, digest)

    def test_read_verified_rejects_oversized_text_even_with_matching_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "license.txt"
            content = b"x" * (128 * 1024 + 1)
            source.write_bytes(content)
            with self.assertRaisesRegex(ValueError, "unexpectedly large"):
                collect_licenses.read_verified(source, hashlib.sha256(content).hexdigest())

    def test_collect_fetches_reviewed_live2d_eulas(self) -> None:
        """Remote Live2D agreements are copied only after exact-byte verification."""
        payload = b"<html>reviewed license</html>"
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            with mock.patch.object(
                collect_licenses.cubism_sdk,
                "fetch_verified_live2d_license",
                side_effect=lambda name: payload + name.encode("utf-8"),
            ):
                collect_licenses.collect(output)
            for name in collect_licenses.cubism_sdk.LIVE2D_REMOTE_LICENSES:
                self.assertEqual((output / name).read_bytes(), payload + name.encode("utf-8"))
            self.assertEqual((output / "GLEW-LICENSE.txt").read_bytes(),
                             (collect_licenses.SOURCE_DIRECTORY / "GLEW-LICENSE.txt").read_bytes())

    def test_collect_rejects_unreviewed_existing_file(self) -> None:
        """An unknown file cannot silently enter the distributed license directory."""
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            (output / "unknown.txt").write_text("unknown", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unexpected existing"):
                collect_licenses.collect(output)

    def test_collect_rejects_unreviewed_existing_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            (output / "unreviewed-sdk").mkdir()
            with self.assertRaisesRegex(ValueError, "unexpected existing"):
                collect_licenses.collect(output)


if __name__ == "__main__":
    unittest.main()
