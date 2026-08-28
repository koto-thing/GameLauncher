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

    def test_windows_and_linux_build_before_one_publish_job(self) -> None:
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

    def test_publish_includes_both_platform_metadata_and_release_assets(self) -> None:
        publish = self.workflow.split("\n  publish:", 1)[1]
        self.assertIn("for platform in windows linux", publish)
        self.assertIn('artifacts/linux/ifw/PandD-Game-Launcher-Online-Installer.asc', publish)
        self.assertIn('artifacts/linux/ifw/PandD-Game-Launcher-linux-x86_64.tar.gz.asc', publish)
        self.assertIn('--platform "$platform" --arch x86_64', publish)


if __name__ == "__main__":
    unittest.main()
