"""Cross-language checks against the Rust executable and the Python contract consumer"""

import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from packages.contracts.validation import canonical_json, validate_contract

ROOT = Path(__file__).resolve().parents[3]
PUBLISHER = os.environ.get("PANDD_PUBLISHER", "pandd-publisher")
OPENSSL = os.environ.get("OPENSSL_EXECUTABLE") or shutil.which("openssl")


class PublisherCliTests(unittest.TestCase):
    """Exercise actual CLI parsing, publication files, and external signature verification"""

    def run_publisher(self, *arguments, success=True):
        """Run the installed executable without a shell or production credentials"""
        result = subprocess.run([PUBLISHER, *map(str, arguments)], capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return result

    def test_incomplete_remote_target_and_short_retention_are_rejected(self):
        """Invalid options fail before source files or remote data are accessed"""
        self.run_publisher("publish-game", "--metadata", "missing.json", "--build-dir", "missing",
                           "--output", "missing", "--base-url", "https://example.test",
                           "--private-key", "missing.pem", "--platform", "windows", "--arch", "x86_64",
                           "--endpoint", "https://example.test", success=False)
        self.run_publisher("gc-local", "--output", "missing", "--grace-days", "6", success=False)

    def test_reviewed_content_and_platform_specific_launcher_metadata(self):
        """Validate all published public JSON using the existing Python schemas"""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            content = ROOT / "services/distribution-content/content"
            self.run_publisher("publish-announcements", "--source", content / "announcements", "--output", root)
            for locale in ("ja-JP", "en-US"):
                self.run_publisher("publish-changelog", "--source", content / f"launcher/changelog.{locale}.json",
                                   "--locale", locale, "--output", root)
                self.run_publisher("publish-launcher", "--source", content / f"launcher/release.{locale}.json",
                                   "--locale", locale, "--platform", "windows", "--arch", "x86_64",
                                   "--base-url", "https://downloads.example.test", "--output", root)
                for relative, schema in [
                    (f"v1/announcements/{locale}.json", "announcements.schema.json"),
                    (f"v1/launcher/changelog/{locale}.json", "launcher-changelog.schema.json"),
                    (f"v1/launcher/releases/{locale}/windows/x86_64/latest.json", "launcher-release.schema.json"),
                ]:
                    document = json.loads((root / relative).read_bytes())
                    validate_contract(document, schema)
                self.assertEqual(document["ifwRepositoryUrl"], "https://downloads.example.test/v1/launcher/ifw/windows/x86_64")

    @unittest.skipUnless(OPENSSL, "OpenSSL is needed for independent consumer verification")
    def test_manifest_signature_matches_existing_consumer_and_openssl_keys(self):
        """Verify Rust output using Python canonical JSON and OpenSSL, in both key directions"""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            build = root / "game"
            build.mkdir()
            (build / "game.exe").write_bytes(b"game payload")
            (root / "hero.png").write_bytes(b"hero")
            (root / "thumbnail.png").write_bytes(b"thumbnail")
            metadata = {
                "gameId": "sample-game", "version": "1.0.0", "minimumLauncherVersion": "1.0.0",
                "publishedAt": "2026-08-10T00:00:00Z", "engine": "godot", "entrypoint": "game.exe",
                "workingDirectory": ".", "saveDirectoryName": "sample-game",
                "display": {"ja-JP": {"name": "日本語", "summary": "署名検証"}},
                "hero": "hero.png", "thumbnail": "thumbnail.png", "heroFocalPoint": {"x": 0.5, "y": 0.5},
            }
            source = root / "release.json"
            source.write_text(json.dumps(metadata), encoding="utf-8")
            private, public = root / "private.pem", root / "public.pem"
            self.run_publisher("init-key", "--private-key", private, "--public-key", public)
            command = ["publish-game", "--metadata", source, "--build-dir", build, "--output", root / "public",
                       "--base-url", "https://example.test", "--private-key", private, "--platform", "windows", "--arch", "x86_64"]
            self.run_publisher(*command)
            manifest = root / "public/v1/games/sample-game/releases/windows/x86_64/1.0.0/manifest.json"
            first = manifest.read_bytes()
            self.run_publisher(*command)
            self.assertEqual(manifest.read_bytes(), first)
            document = json.loads(first)
            validate_contract(document, "game-release.schema.json")
            (root / "signature").write_bytes(base64.b64decode(document.pop("signature")))
            (root / "payload").write_bytes(canonical_json(document))
            subprocess.run([OPENSSL, "pkeyutl", "-verify", "-pubin", "-inkey", str(public), "-rawin",
                            "-in", str(root / "payload"), "-sigfile", str(root / "signature")], check=True, capture_output=True)

            subprocess.run([OPENSSL, "genpkey", "-algorithm", "ED25519", "-out", str(root / "openssl.pem")], check=True, capture_output=True)
            signature = self.run_publisher("sign-file", "--source", root / "payload", "--private-key", root / "openssl.pem").stdout.strip()
            (root / "signature").write_bytes(base64.b64decode(signature, validate=True))
            subprocess.run([OPENSSL, "pkeyutl", "-verify", "-inkey", str(root / "openssl.pem"), "-rawin",
                            "-in", str(root / "payload"), "-sigfile", str(root / "signature")], check=True, capture_output=True)

            (build / "game.exe").write_bytes(b"changed payload")
            self.run_publisher(*command, success=False)
            self.assertEqual(manifest.read_bytes(), first)


if __name__ == "__main__":
    unittest.main()
