"""Tests for the Actions-side intake artifact verifier."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from scripts.validate_intake_artifact import validate_and_extract


class ValidateIntakeArtifactTests(unittest.TestCase):
    def fixture(self, root: Path, unsafe: bool = False) -> tuple[Path, Path]:
        archive = root / "artifact.zip"
        metadata = json.dumps({
            "gameId": "sample-game",
            "version": "1.0.0",
            "minimumLauncherVersion": "1.0.1",
            "publishedAt": "2026-08-13T00:00:00Z",
            "engine": "unity",
            "entrypoint": "game.exe",
            "workingDirectory": ".",
            "saveDirectoryName": "SampleGame",
            "display": {"ja-JP": {"name": "Sample", "summary": "Summary"}},
            "hero": "hero.png",
            "heroFocalPoint": {"x": 0.5, "y": 0.5},
            "thumbnail": "thumbnail.png",
        }).encode()
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("metadata/release.json", metadata)
            bundle.writestr("metadata/hero.png", b"hero")
            bundle.writestr("metadata/thumbnail.png", b"thumbnail")
            bundle.writestr("build/game.exe", b"game")
            if unsafe:
                bundle.writestr("../escape.txt", b"escape")
        snapshot = root / "snapshot.json"
        snapshot.write_text(json.dumps({
            "artifact": {
                "sizeBytes": archive.stat().st_size,
                "fileCount": 5 if unsafe else 4,
                "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            },
            "metadata": {"gameId": "sample-game", "version": "1.0.0"},
        }), encoding="utf-8")
        return archive, snapshot

    def test_extracts_a_matching_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive, snapshot = self.fixture(root)
            output = root / "output"
            validate_and_extract(archive, snapshot, output)
            self.assertEqual((output / "build/game.exe").read_bytes(), b"game")

    def test_rejects_path_traversal_and_removes_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive, snapshot = self.fixture(root, unsafe=True)
            output = root / "output"
            with self.assertRaisesRegex(ValueError, "unsafe .*path"):
                validate_and_extract(archive, snapshot, output)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
