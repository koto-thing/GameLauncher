"""Tests for the intake uploader without requiring a GUI runtime."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile

from pandd_intake_uploader.application import (
    ArtifactCancelled, ArtifactService, CancellationToken, IntakeSettings, ReleaseDraft,
    Translation, ValidationError, create_metadata, validate_draft,
)


class MaintenanceApplicationTests(unittest.TestCase):
    def make_draft(self, root: Path) -> ReleaseDraft:
        build = root / "build"
        (build / "bin").mkdir(parents=True)
        executable = build / "bin/game.exe"
        executable.write_bytes(b"game")
        (build / "bin/game_Data").mkdir()
        (build / "bin/game_Data/data.bin").write_bytes(b"data")
        hero = root / "hero.png"
        thumbnail = root / "thumbnail.webp"
        hero.write_bytes(b"hero")
        thumbnail.write_bytes(b"thumbnail")
        return ReleaseDraft(
            build, executable, "sample-game", "1.0.0", "1.0.1", "unity", "SampleGame",
            {
                "ja-JP": Translation("サンプルゲーム", "説明"),
                "ko-KR": Translation("샘플 게임", "설명"),
            },
            hero, thumbnail,
        )

    def test_validates_and_generates_multilingual_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            draft = self.make_draft(root)
            preview = validate_draft(draft)
            self.assertEqual(preview.entrypoint, "bin/game.exe")
            self.assertEqual(preview.locales, ("ja-JP", "ko-KR"))
            metadata = create_metadata(draft, root / "metadata")
            document = json.loads(metadata.read_text(encoding="utf-8"))
            self.assertEqual(set(document["display"]), {"ja-JP", "ko-KR"})
            self.assertEqual(document["workingDirectory"], "bin")

    def test_requires_japanese_and_rejects_executable_outside_build(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            draft = self.make_draft(root)
            outside = root / "outside.exe"
            outside.write_bytes(b"outside")
            invalid = ReleaseDraft(
                draft.build_directory, outside, draft.game_id, draft.version,
                draft.minimum_launcher_version, draft.engine, draft.save_directory_name,
                {"en-US": Translation("Sample", "Summary")}, draft.hero, draft.thumbnail,
            )
            with self.assertRaisesRegex(ValidationError, "日本語"):
                validate_draft(invalid)

    def test_executable_at_build_root_uses_root_working_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            draft = self.make_draft(root)
            root_executable = draft.build_directory / "PixelPile.exe"
            root_executable.write_bytes(b"game")
            direct = ReleaseDraft(
                draft.build_directory, root_executable, draft.game_id, draft.version,
                draft.minimum_launcher_version, draft.engine, draft.save_directory_name,
                draft.translations, draft.hero, draft.thumbnail,
            )
            preview = validate_draft(direct)
            self.assertEqual(preview.entrypoint, "PixelPile.exe")
            self.assertEqual(preview.working_directory, ".")

    def test_cancellation_token_is_always_available_during_local_creation(self) -> None:
        token = CancellationToken()
        self.assertTrue(token.request())
        self.assertTrue(token.is_requested())

    def test_distribution_defaults_to_hosted_control_plane(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, \
                mock.patch.dict("os.environ", {}, clear=True):
            settings = IntakeSettings.from_environment(Path(temporary))
            self.assertEqual(
                settings.control_plane_url,
                "https://pandd-deployment-control-plane.gotoukenta62.workers.dev",
            )

    def test_creates_zip64_artifact_and_safe_descriptor(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            draft = self.make_draft(root)
            output = root / "output"
            result = ArtifactService(IntakeSettings(output, "http://localhost:3000")).create(draft)
            descriptor = json.loads(result.descriptor_path.read_text(encoding="utf-8"))
            self.assertEqual(descriptor["artifactId"], result.artifact_id)
            self.assertEqual(descriptor["sha256"], result.sha256)
            self.assertNotIn(str(root), result.descriptor_path.read_text(encoding="utf-8"))
            with zipfile.ZipFile(result.archive_path) as archive:
                self.assertEqual(
                    set(archive.namelist()),
                    {
                        "build/bin/game.exe",
                        "build/bin/game_Data/data.bin",
                        "metadata/release.json",
                        "metadata/hero.png",
                        "metadata/thumbnail.webp",
                    },
                )

    def test_rejects_windows_reserved_archive_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            draft = self.make_draft(root)
            (draft.build_directory / "CON.txt").write_bytes(b"reserved")
            with self.assertRaisesRegex(ValidationError, "Windows予約名"):
                ArtifactService(IntakeSettings(root / "output", "http://localhost:3000")).create(draft)

    def test_cancelled_creation_removes_partial_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            draft = self.make_draft(root)
            output = root / "output"
            token = CancellationToken()
            token.request()
            with self.assertRaises(ArtifactCancelled):
                ArtifactService(IntakeSettings(output, "http://localhost:3000")).create(
                    draft, cancellation=token,
                )
            self.assertFalse(any(output.glob("*.zip")))
            self.assertFalse(any(output.glob("*.pandd-artifact.json")))


if __name__ == "__main__":
    unittest.main()
