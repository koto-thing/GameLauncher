"""Behavioral tests for physical media construction and installer composition."""

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from scripts.editions.build import materialize_game, package, download
from services.deployment_publisher.publisher import CHUNK_SIZE


class PhysicalMediaTests(unittest.TestCase):
    """Exercise payload integrity and installer ownership without production access."""

    def release(self, path="bin/game.exe"):
        """Build a signed-manifest-shaped fixture with two ordered chunks."""
        chunks = [b"hello", b" world"]
        return {"totalSize": 11, "files": [{"path": path, "size": 11,
            "sha256": hashlib.sha256(b"hello world").hexdigest(),
            "chunks": [{"offset": 0 if index == 0 else 5, "size": len(data),
                        "url": str(index), "sha256": hashlib.sha256(data).hexdigest()}
                       for index, data in enumerate(chunks)]}]}

    def test_materializes_exact_verified_content(self):
        """Reconstruct files exactly from the manifest's ordered chunks."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            materialize_game(self.release(), root, lambda url, _: [b"hello", b" world"][int(url)])
            self.assertEqual((root / "bin/game.exe").read_bytes(), b"hello world")

    def test_rejects_corruption_and_unsafe_paths(self):
        """Corrupt bytes and Windows path aliases cannot become distributable files."""
        for path in ("../escape.exe", "C:/escape", "bin/CON.exe", "bin/trailing.", "bin/a:b"):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaises(ValueError):
                    materialize_game(self.release(path), Path(temporary), lambda *_: b"bad")
        with tempfile.TemporaryDirectory() as temporary, self.assertRaises(ValueError):
            materialize_game(self.release(), Path(temporary), lambda *_: b"wrong")

    def test_rejects_chunk_gaps(self):
        """An inconsistent offset is rejected before activation or packaging."""
        release = self.release()
        release["files"][0]["chunks"][0]["offset"] = 1
        with tempfile.TemporaryDirectory() as temporary, self.assertRaises(ValueError):
            materialize_game(release, Path(temporary), lambda *_: b"hello")

    def test_accepts_full_production_chunk(self):
        """Published 64 MiB chunks must remain installable from physical media."""
        data = b"x" * CHUNK_SIZE
        digest = hashlib.sha256(data).hexdigest()
        release = {"totalSize": len(data), "files": [{"path": "game.exe", "size": len(data),
                   "sha256": digest, "chunks": [{"offset": 0, "size": len(data), "sha256": digest, "url": "chunk"}]}]}
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            materialize_game(release, target, lambda *_: data)
            self.assertEqual((target / "game.exe").stat().st_size, CHUNK_SIZE)

    def test_never_downloads_from_untrusted_origins(self):
        """Payload fetches cannot follow user-controlled origins."""
        for url in ("http://downloads.koto-thing.com/v1/x", "https://evil.example/v1/x", "file:///etc/passwd"):
            with self.assertRaises(ValueError):
                download(url, 100)

    def test_installer_separates_profile_and_optional_game_ownership(self):
        """The shared updater does not own edition metadata or mutable game files."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            profile = root / "work/media/edition"
            profile.mkdir(parents=True)
            definition = {"id": "test-edition", "name": "イベント版", "games": ["sample-game"]}
            (profile / "edition.json").write_text(json.dumps(definition), encoding="utf-8")
            (profile / "catalog.json").write_text(json.dumps({"games": [{"gameId": "sample-game", "name": "Game", "summary": "Sample"}]}), encoding="utf-8")
            (root / "work/snapshot.json").write_text("{}")
            install = root / "install"
            install.mkdir()
            (install / "marker").write_text("common engine")

            def inspect(command, **_):
                """Inspect the actual IFW input before its temporary tree disappears."""
                self.assertIn("--hybrid", command)
                packages = Path(command[command.index("-p") + 1])
                self.assertTrue((packages / "org.pandd.edition/data/edition/edition.json").exists())
                self.assertFalse((packages / "org.pandd.launcher/data/edition").exists())
                game = packages / "org.pandd.game.sample_game/meta"
                xml = ET.parse(game / "package.xml")
                self.assertIsNone(xml.find("ForcedInstallation"))
                self.assertIn("--install-media", (game / "installscript.qs").read_text(encoding="utf-8"))
                self.assertFalse((game.parent / "data").exists())
                Path(command[-1]).write_bytes(b"installer")

            with patch("scripts.editions.build.executable", return_value=Path("binarycreator")), patch("scripts.editions.build.subprocess.run", side_effect=inspect):
                result = package(root / "work", install, root / "output", "1.0.0", None)
            self.assertTrue(result.exists())
            self.assertTrue((root / "output/media/edition/edition.json").exists())


if __name__ == "__main__":
    unittest.main()
