"""Tests for release-specific Qt IFW metadata generation."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

from installer.build import configure_metadata
from installer.e2e import installed_launcher, maintenance_tool, platform_executable


class InstallerBuildTests(unittest.TestCase):
    """Verify production/staging values never require source metadata mutation."""

    def test_configure_metadata_sets_version_date_and_repository(self) -> None:
        """A work copy receives all environment-specific release values."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(__file__).resolve().parent
            config = Path(temporary) / "config.xml"
            package = Path(temporary) / "package.xml"
            shutil.copy2(root / "config/config.xml", config)
            shutil.copy2(root / "packages/org.pandd.launcher/meta/package.xml", package)

            configure_metadata(config, package, "2.3.4",
                               "https://downloads.koto-thing.com/v1/launcher/ifw/windows/x86_64")

            config_root = ET.parse(config).getroot()
            package_root = ET.parse(package).getroot()
            self.assertEqual(config_root.findtext("Version"), "2.3.4")
            self.assertEqual(config_root.findtext("RemoteRepositories/Repository/Url"),
                             "https://downloads.koto-thing.com/v1/launcher/ifw/windows/x86_64")
            self.assertEqual(package_root.findtext("Version"), "2.3.4")

    def test_installer_uses_bundled_standard_wizard_style(self) -> None:
        """The visual configuration and its referenced stylesheet ship together."""
        root = Path(__file__).resolve().parent
        config_root = ET.parse(root / "config/config.xml").getroot()

        self.assertEqual(config_root.findtext("WizardStyle"), "Classic")
        self.assertEqual(config_root.findtext("WizardShowPageList"), "false")
        self.assertTrue((root / "config" / config_root.findtext("StyleSheet")).is_file())

    def test_e2e_paths_match_the_current_platform(self) -> None:
        """E2E must inspect actual installed binaries instead of a generic placeholder path."""
        root = Path("installation")
        artifact = platform_executable(Path("artifacts/PandD-Game-Launcher-Online-Installer"))
        if os.name == "nt":
            self.assertEqual(artifact.suffix, ".exe")
            self.assertEqual(installed_launcher(root).name, "PandD Game Launcher.exe")
            self.assertEqual(maintenance_tool(root).name, "maintenancetool.exe")
        elif sys.platform == "darwin":
            self.assertIn(".app", artifact.as_posix())
            self.assertIn(".app", installed_launcher(root).as_posix())
            self.assertIn(".app", maintenance_tool(root).as_posix())
        else:
            self.assertEqual(artifact.name, "PandD-Game-Launcher-Online-Installer")
            self.assertEqual(installed_launcher(root).name, "PandD Game Launcher")
            self.assertEqual(maintenance_tool(root).name, "maintenancetool")


if __name__ == "__main__":
    unittest.main()
