"""Contract tests for the protected desktop release workflow."""

from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/release.yml"


class DesktopReleaseWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")

    def test_all_desktop_platforms_build_before_one_publish_job(self) -> None:
        self.assertIn("build-windows:", self.workflow)
        self.assertIn("build-linux:", self.workflow)
        self.assertIn("needs: [build-windows, build-linux]", self.workflow)
        self.assertEqual(self.workflow.count("Publish desktop artifacts to GitHub Release"), 1)

    def test_linux_release_is_production_built_smoke_tested_and_signed(self) -> None:
        linux = self.workflow.split("  build-linux:", 1)[1].split("\n  publish:", 1)[0]
        self.assertIn("-DCMAKE_BUILD_TYPE=Release", linux)
        self.assertIn("-DPANDD_DISTRIBUTION_ENV=production", linux)
        self.assertIn("smoke_test_linux.sh", linux)
        self.assertIn("/v1/launcher/ifw/linux/x86_64", linux)
        self.assertIn("LINUX_GPG_PRIVATE_KEY_BASE64", linux)
        self.assertIn("LINUX_GPG_KEY_ID", linux)
        self.assertEqual(linux.count("scripts/signing/sign_linux.sh"), 2)

    def test_macos_is_excluded_until_signing_is_available(self) -> None:
        self.assertNotIn("build-macos", self.workflow)
        self.assertNotIn("artifacts/macos", self.workflow)
        self.assertNotIn("macos/arm64", self.workflow)
        self.assertNotIn("MACOS_", self.workflow)

    def test_all_builds_wait_for_production_secret_validation(self) -> None:
        from scripts.release.validate_desktop_secrets import REQUIRED_SECRETS

        preflight = self.workflow.split("  verify-secrets:", 1)[1].split("  build-windows:", 1)[0]
        self.assertIn("environment: production", preflight)
        self.assertIn("python -m scripts.release.validate_desktop_secrets", preflight)
        for name in REQUIRED_SECRETS:
            self.assertIn("${{ secrets." + name + " }}", preflight)
        for platform in ("windows", "linux"):
            job = self.workflow.split(f"  build-{platform}:\n", 1)[1]
            self.assertTrue(job.startswith("    needs: verify-secrets\n"))

    def test_publish_includes_all_platform_metadata_and_release_assets(self) -> None:
        publish = self.workflow.split("\n  publish:", 1)[1]
        self.assertIn("for platform_arch in windows/x86_64 linux/x86_64", publish)
        self.assertIn('artifacts/linux/ifw/PandD-Game-Launcher-Online-Installer.asc', publish)
        self.assertIn('artifacts/linux/ifw/PandD-Game-Launcher-linux-x86_64.tar.gz.asc', publish)
        self.assertIn('--platform "$platform" --arch "$arch"', publish)

    def test_pointer_is_promoted_last_and_publications_are_serialized(self):
        publish = self.workflow.split("\n  publish:", 1)[1]
        self.assertIn("group: launcher-production-publication", publish)
        self.assertIn("cancel-in-progress: false", publish)
        self.assertLess(publish.index("--check-only"), publish.index("Upload immutable objects"))
        self.assertLess(publish.index("gh release upload"), publish.index("Promote verified Windows installer"))

    def test_recovery_reuses_published_assets_and_production_lock(self):
        recovery = (ROOT / ".github/workflows/promote-desktop-download.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", recovery)
        self.assertIn('test "$GITHUB_REF" = refs/heads/master', recovery)
        self.assertIn("environment: production", recovery)
        self.assertIn("group: launcher-production-publication", recovery)
        self.assertIn("contents: read", recovery)
        self.assertIn("gh release download", recovery)
        self.assertIn("--pattern PandD-Game-Launcher-Online-Installer.exe.sha256", recovery)
        self.assertIn("python -m scripts.release.promote_installer", recovery)
        self.assertNotIn("cmake --build", recovery)
        self.assertNotIn("publisher.py upload", recovery)
        self.assertNotIn("gh release upload", recovery)


if __name__ == "__main__":
    unittest.main()
