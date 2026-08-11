"""Contract tests for the static Publisher."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from publisher import (build_game_release, canonical_json, clean_unreferenced_blobs, create_key,
                       main, publication_content_type, publish_launcher_changelog,
                       publish_launcher_release, remote_gc, sha256_bytes, sha256_file,
                       validate_relative_path)
from publisher import upload_tree


class PublisherTests(unittest.TestCase):
    """Verify deterministic serialization and path safety without network access."""

    def test_canonical_json_is_stable(self) -> None:
        """Object insertion order must not affect signed bytes."""
        self.assertEqual(canonical_json({"b": 2, "a": 1}), b'{"a":1,"b":2}')

    def test_sha256_uses_lowercase_hex(self) -> None:
        """Content keys must match the client contract."""
        self.assertEqual(sha256_bytes(b"abc"),
                         "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

    def test_path_traversal_is_rejected(self) -> None:
        """Publisher must reject paths the client would reject."""
        with self.assertRaises(ValueError):
            validate_relative_path("../escape.exe")
        with self.assertRaises(ValueError):
            validate_relative_path("C:\\escape.exe")
        self.assertEqual(str(validate_relative_path("bin/game.exe")), "bin/game.exe")

    def test_publish_game_requires_complete_remote_target(self) -> None:
        """A one-command promotion cannot guess half of an R2 destination."""
        arguments = [
            "publisher.py", "publish-game", "--metadata", "release.json", "--build-dir", "game",
            "--output", "public", "--base-url", "https://downloads.pandd.org",
            "--private-key", "key.pem", "--platform", "windows", "--arch", "x86_64",
            "--endpoint", "https://r2.example",
        ]
        with mock.patch.object(sys, "argv", arguments), self.assertRaises(ValueError):
            main()

    def test_gc_keeps_only_current_and_previous_release_references(self) -> None:
        """Old releases and blobs are removed only after the seven-day grace period."""
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            release_root = output / "v1/games/sample-game/releases/windows/x86_64"
            blob_root = output / "v1/blobs/sha256"
            blob_root.mkdir(parents=True)

            def manifest(version: str, digest: str) -> dict:
                """Create the minimal retention fixture manifest."""
                return {"version": version, "files": [{"chunks": [{"sha256": digest}]}]}

            for version, digest in (("1.9.0", "old"), ("1.10.0", "previous"),
                                    ("2.0.0", "current"), ("3.0.0", "aborted")):
                path = release_root / version / "manifest.json"
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps(manifest(version, digest)), encoding="utf-8")
                (blob_root / digest).write_bytes(digest.encode())
            latest = release_root / "latest.json"
            latest.write_text(json.dumps(manifest("2.0.0", "current")), encoding="utf-8")
            fresh = blob_root / "fresh-unreferenced"
            fresh.write_bytes(b"fresh")

            old_timestamp = 1
            for path in [*release_root.glob("*/manifest.json"),
                         *(blob_root / name for name in ("old", "previous", "current", "aborted"))]:
                os.utime(path, (old_timestamp, old_timestamp))

            removed = clean_unreferenced_blobs(output, 7, False)
            self.assertIn(release_root / "1.9.0", removed)
            self.assertIn(release_root / "3.0.0", removed)
            self.assertTrue((release_root / "1.10.0/manifest.json").exists())
            self.assertTrue((release_root / "2.0.0/manifest.json").exists())
            self.assertTrue((blob_root / "previous").exists())
            self.assertTrue((blob_root / "current").exists())
            self.assertFalse((blob_root / "old").exists())
            self.assertFalse((blob_root / "aborted").exists())
            self.assertTrue(fresh.exists())

    def test_launcher_repository_is_platform_specific(self) -> None:
        """Each platform points at its own non-conflicting Qt IFW repository."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "release.json"
            source.write_text(json.dumps({
                "version": "1.2.3", "mandatory": False, "title": "Release",
                "publishedAt": "2026-08-10T00:00:00Z",
            }), encoding="utf-8")
            publish_launcher_release(source, root / "public", "https://downloads.pandd.org",
                                     "ja-JP", "windows", "x86_64")
            latest = json.loads((root / "public/v1/launcher/releases/ja-JP/windows/"
                                 "x86_64/latest.json").read_text(encoding="utf-8"))
            self.assertEqual(latest["ifwRepositoryUrl"],
                             "https://downloads.pandd.org/v1/launcher/ifw/windows/x86_64")

    def test_launcher_changelog_has_one_dedicated_source(self) -> None:
        """Localized history must not silently fall back to release metadata."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "changelog.json"
            document = {"schemaVersion": 1, "releases": [{
                "version": "1.2.3", "title": "Release",
                "publishedAt": "2026-08-10T00:00:00Z", "changes": ["Change"],
            }]}
            source.write_text(json.dumps(document), encoding="utf-8")
            publish_launcher_changelog(source, root / "public", "en-US")
            published = json.loads(
                (root / "public/v1/launcher/changelog/en-US.json").read_text(encoding="utf-8"))
            self.assertEqual(published, document)

    def test_remote_gc_retains_current_previous_and_their_blobs(self) -> None:
        """Remote cleanup must fail closed around every retained release reference."""
        old = "2020-01-01T00:00:00Z"
        prefix = "v1/games/sample/releases/windows/x86_64"
        digests = {"current": "a" * 64, "previous": "b" * 64, "obsolete": "c" * 64}
        documents = {
            f"{prefix}/latest.json": {"version": "2.0.0"},
            f"{prefix}/2.0.0/manifest.json": {
                "files": [{"chunks": [{"sha256": digests["current"]}]}]},
            f"{prefix}/1.0.0/manifest.json": {
                "files": [{"chunks": [{"sha256": digests["previous"]}]}]},
            f"{prefix}/0.9.0/manifest.json": {
                "files": [{"chunks": [{"sha256": digests["obsolete"]}]}]},
        }
        keys = [*documents, *(f"v1/blobs/sha256/{digest}" for digest in digests.values())]
        inventory = {"Contents": [{"Key": key, "LastModified": old} for key in keys]}
        calls: list[list[str]] = []

        def run(arguments: list[str], **_: object) -> subprocess.CompletedProcess:
            """Serve a deterministic remote inventory and capture delete requests."""
            calls.append(arguments)
            if arguments[1:3] == ["s3api", "list-objects-v2"]:
                return subprocess.CompletedProcess(arguments, 0, stdout=json.dumps(inventory))
            if arguments[1:3] == ["s3", "cp"]:
                key = arguments[3].split("bucket/", 1)[1]
                return subprocess.CompletedProcess(arguments, 0,
                                                   stdout=json.dumps(documents[key]))
            return subprocess.CompletedProcess(arguments, 0, stdout="")

        with mock.patch.object(remote_gc.__globals__["shutil"], "which", return_value="aws"), \
             mock.patch.object(remote_gc.__globals__["subprocess"], "run", side_effect=run):
            removed = remote_gc("https://r2.example", "bucket", 7, False)

        self.assertEqual(removed, [
            f"{prefix}/0.9.0/manifest.json",
            f"v1/blobs/sha256/{digests['obsolete']}",
        ])
        deleted = [call[call.index("--key") + 1] for call in calls
                   if call[1:3] == ["s3api", "delete-object"]]
        self.assertEqual(deleted, removed)

    def test_upload_promotes_latest_after_all_supporting_objects(self) -> None:
        """Latest is the final mutable pointer and every remote size is verified."""
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            files = {
                "v1/blobs/sha256/blob": b"blob",
                "v1/launcher/ifw/windows/x86_64/Updates.xml": b"updates",
                "v1/launcher/releases/ja-JP/windows/x86_64/latest.json": b"latest",
            }
            for relative, content in files.items():
                path = output / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)

            calls: list[list[str]] = []
            uploaded_keys: set[str] = set()

            def run(arguments: list[str], **_: object) -> subprocess.CompletedProcess:
                """Record uploads and return matching remote object sizes."""
                calls.append(arguments)
                if arguments[1:3] == ["s3", "cp"]:
                    uploaded_keys.add(arguments[4].split("bucket/", 1)[1])
                if arguments[1] == "s3api":
                    key = arguments[arguments.index("--key") + 1]
                    if key not in uploaded_keys:
                        return subprocess.CompletedProcess(arguments, 255, stdout="")
                    source = output / key
                    metadata = {
                        "size": len(files[key]),
                        "sha256": sha256_file(source),
                        "contentType": publication_content_type(source),
                    }
                    return subprocess.CompletedProcess(arguments, 0, stdout=json.dumps(metadata))
                return subprocess.CompletedProcess(arguments, 0, stdout="")

            with mock.patch.object(upload_tree.__globals__["shutil"], "which",
                                   return_value="aws"), \
                 mock.patch.object(upload_tree.__globals__["subprocess"], "run",
                                   side_effect=run):
                upload_tree(output, "https://r2.example", "bucket")

            uploaded = [call[4].split("bucket/", 1)[1] for call in calls if call[1:3] == ["s3", "cp"]]
            self.assertEqual(uploaded[-1],
                             "v1/launcher/releases/ja-JP/windows/x86_64/latest.json")
            uploads = [call for call in calls if call[1:3] == ["s3", "cp"]]
            self.assertTrue(all("--content-type" in call and "--metadata" in call
                                for call in uploads))

    def test_upload_refuses_remote_immutable_mismatch(self) -> None:
        """A versioned remote key must never be overwritten with different bytes."""
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            immutable = output / "v1/blobs/sha256/blob"
            immutable.parent.mkdir(parents=True)
            immutable.write_bytes(b"local")

            def run(arguments: list[str], **_: object) -> subprocess.CompletedProcess:
                """Report a conflicting object for the immutable preflight."""
                if arguments[1:3] == ["s3api", "head-object"]:
                    return subprocess.CompletedProcess(
                        arguments, 0,
                        stdout=json.dumps({"size": 6, "sha256": "different",
                                           "contentType": "application/octet-stream"}))
                self.fail("immutable conflict should stop before upload")

            with mock.patch.object(upload_tree.__globals__["shutil"], "which",
                                   return_value="aws"), \
                 mock.patch.object(upload_tree.__globals__["subprocess"], "run",
                                   side_effect=run):
                with self.assertRaisesRegex(RuntimeError, "refusing to overwrite"):
                    upload_tree(output, "https://r2.example", "bucket")

    @unittest.skipUnless(os.environ.get("OPENSSL_EXECUTABLE") or shutil.which("openssl"),
                         "OpenSSL is not available")
    def test_release_is_signed_and_idempotent(self) -> None:
        """A rerun must preserve immutable bytes and produce a verifiable signature."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            build = root / "build"
            output = root / "output"
            source.mkdir()
            (build / "bin").mkdir(parents=True)
            (source / "hero.png").write_bytes(b"hero")
            (source / "thumbnail.png").write_bytes(b"thumbnail")
            (build / "bin" / "game.exe").write_bytes(b"fixture game")
            metadata = {
                "gameId": "sample-game", "version": "1.0.0",
                "minimumLauncherVersion": "1.0.0", "publishedAt": "2026-08-10T00:00:00Z",
                "engine": "godot", "entrypoint": "bin/game.exe", "workingDirectory": "bin",
                "saveDirectoryName": "sample-game",
                "display": {
                    "ja-JP": {"name": "サンプル", "summary": "テスト用ゲーム"},
                    "en-US": {"name": "Sample", "summary": "Fixture"},
                },
                "hero": "hero.png", "thumbnail": "thumbnail.png",
                "heroFocalPoint": {"x": 0.5, "y": 0.5},
            }
            metadata_path = source / "release.json"
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            private_key = root / "private.pem"
            public_key = root / "public.pem"
            create_key(private_key, public_key)
            build_game_release(metadata_path, build, output, "https://downloads.example.test",
                               private_key, "windows", "x86_64")
            immutable = output / "v1/games/sample-game/releases/windows/x86_64/1.0.0/manifest.json"
            first_bytes = immutable.read_bytes()
            build_game_release(metadata_path, build, output, "https://downloads.example.test",
                               private_key, "windows", "x86_64")
            self.assertEqual(immutable.read_bytes(), first_bytes)

            document = json.loads(first_bytes)
            signature = base64.b64decode(document.pop("signature"))
            payload = root / "payload.json"
            signature_path = root / "signature.bin"
            payload.write_bytes(canonical_json(document))
            signature_path.write_bytes(signature)
            executable = os.environ.get("OPENSSL_EXECUTABLE") or shutil.which("openssl")
            result = subprocess.run([executable, "pkeyutl", "-verify", "-pubin", "-inkey",
                                     str(public_key), "-rawin", "-in", str(payload),
                                     "-sigfile", str(signature_path)], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))


if __name__ == "__main__":
    unittest.main()
