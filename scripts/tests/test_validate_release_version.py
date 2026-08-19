"""Tests for release identity validation."""

from __future__ import annotations

import re
import unittest

from scripts.release.validate_release_version import ROOT, validate_release_version


class ValidateReleaseVersionTests(unittest.TestCase):
    def test_checked_in_release_identity_is_consistent(self) -> None:
        cmake = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
        version = re.search(r"project\(PandDGameLauncher VERSION ([^ )]+)", cmake).group(1)
        self.assertEqual(validate_release_version(f"v{version}"), version)

    def test_mismatched_or_invalid_version_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "CMake project version"):
            validate_release_version("9.9.9")
        with self.assertRaisesRegex(ValueError, "must be SemVer"):
            validate_release_version("release-latest")
