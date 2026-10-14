"""Exercise recovery hash pinning and catalogue visibility without remote writes."""

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.deployment.prepare_game_recovery import prepare
from services.deployment_publisher.publisher import build_game_release, canonical_json, create_key


class RecoveryTests(unittest.TestCase):
    """Use real signed manifests and schema validation for rollback/suspension."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.output = root / "public"
        build = root / "build"
        build.mkdir()
        (build / "game.exe").write_bytes(b"game fixture")
        (root / "hero.png").write_bytes(b"image fixture")
        self.metadata = {
            "gameId": "sample-game", "version": "1.0.0", "minimumLauncherVersion": "1.0.0",
            "publishedAt": "2026-08-10T00:00:00Z", "engine": "godot", "entrypoint": "game.exe",
            "workingDirectory": ".", "saveDirectoryName": "sample-game",
            "display": {"ja-JP": {"name": "Sample", "summary": "Fixture"}},
            "hero": "hero.png", "thumbnail": "hero.png", "heroFocalPoint": {"x": 0.5, "y": 0.5},
        }
        metadata = root / "release.json"
        metadata.write_text(json.dumps(self.metadata), encoding="utf-8")
        create_key(root / "private.pem", root / "public.pem")
        self.base = "https://downloads.example.test"
        build_game_release(metadata, build, self.output, self.base, root / "private.pem", "windows", "x86_64")
        self.manifest = json.loads((self.output / "v1/games/sample-game/releases/windows/x86_64/1.0.0/manifest.json").read_text())
        self.digest = hashlib.sha256(canonical_json(self.manifest)).hexdigest()

    def test_recovery_requires_exact_verified_manifest(self):
        """Neither a wrong digest nor unknown mode can reach pointer promotion."""
        for mode in ("rollback", "suspend", "resume"):
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, "differs"):
                prepare({"recovery": {"mode": mode, "manifestSha256": "0" * 64}}, self.metadata, self.output, self.base)
        with self.assertRaisesRegex(ValueError, "invalid recovery"):
            prepare({"recovery": {"mode": "delete"}}, self.metadata, self.output, self.base)
        for mode in ("rollback", "resume"):
            prepare({"recovery": {"mode": mode, "manifestSha256": self.digest}}, self.metadata, self.output, self.base)

    def test_suspend_current_version_unlists_without_deleting_content(self):
        """Suspension preserves immutable files and refuses a stale version selection."""
        snapshot = {"recovery": {"mode": "suspend", "manifestSha256": self.digest}}
        with patch("scripts.deployment.prepare_game_recovery.read_json", return_value=({**self.manifest, "version": "2.0.0"}, b"")):
            with self.assertRaisesRegex(ValueError, "currently published"):
                prepare(snapshot, self.metadata, self.output, self.base)
        before = set(self.output.rglob("*"))
        with patch("scripts.deployment.prepare_game_recovery.read_json", return_value=(self.manifest, b"")):
            prepare(snapshot, self.metadata, self.output, self.base)
        self.assertEqual(before, set(self.output.rglob("*")))
        catalog = json.loads((self.output / "v1/catalog/ja-JP/windows/x86_64.json").read_text())
        self.assertEqual(catalog["games"], [])

    def test_recovery_does_not_change_other_platform_catalogues(self):
        """The existing Windows x86_64 workflow leaves Linux/macOS pointers untouched."""
        paths = [self.output / "v1/catalog/ja-JP/linux/x86_64.json", self.output / "v1/catalog/ja-JP/macos/arm64.json"]
        for path in paths:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"other platform fixture")
        for mode in ("rollback", "suspend", "resume"):
            with patch("scripts.deployment.prepare_game_recovery.read_json", return_value=(self.manifest, b"")):
                prepare({"recovery": {"mode": mode, "manifestSha256": self.digest}}, self.metadata, self.output, self.base)
            for path in paths:
                self.assertEqual(path.read_bytes(), b"other platform fixture")


if __name__ == "__main__":
    unittest.main()
