"""Tests for fail-closed license text collection."""

from __future__ import annotations

import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from scripts import collect_licenses


class _Response(io.BytesIO):
    """Minimal context-managed urllib response fixture."""

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


class LicenseCollectorTests(unittest.TestCase):
    """Verify release text pins cannot be bypassed by changed upstream bytes."""

    def test_fetch_verified_accepts_only_the_pinned_hash(self) -> None:
        """Matching bytes pass while any upstream mutation fails closed."""
        content = b"license text"
        digest = hashlib.sha256(content).hexdigest()
        with mock.patch.object(collect_licenses.urllib.request, "urlopen",
                               return_value=_Response(content)):
            self.assertEqual(collect_licenses.fetch_verified("https://license.test", digest),
                             content)
        with mock.patch.object(collect_licenses.urllib.request, "urlopen",
                               return_value=_Response(b"changed")):
            with self.assertRaisesRegex(ValueError, "license hash changed"):
                collect_licenses.fetch_verified("https://license.test", digest)

    def test_collect_rejects_unreviewed_existing_file(self) -> None:
        """An unknown file cannot silently enter the distributed license directory."""
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            (output / "unknown.txt").write_text("unknown", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unexpected existing"):
                collect_licenses.collect(output)


if __name__ == "__main__":
    unittest.main()
