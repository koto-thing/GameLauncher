"""Tests for release-specific Qt IFW metadata generation and UI contract."""

from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

from installer.build import configure_metadata
from installer.e2e import installed_launcher, maintenance_tool, platform_executable


class InstallerBuildTests(unittest.TestCase):
    """Verify production/staging values, official Qt IFW API compliance, and dark UI contracts."""

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

    def test_installer_visual_configuration_and_bundled_assets(self) -> None:
        """The visual configuration and its referenced assets ship together."""
        root = Path(__file__).resolve().parent
        config_root = ET.parse(root / "config/config.xml").getroot()

        self.assertEqual(config_root.findtext("WizardStyle"), "Classic")
        self.assertEqual(config_root.findtext("WizardShowPageList"), "false")
        self.assertTrue((root / "config" / config_root.findtext("StyleSheet")).is_file())

        icon = config_root.findtext("InstallerWindowIcon")
        self.assertEqual(icon, "PnadDLogo.png")
        self.assertIsNone(config_root.find("Logo"))
        self.assertTrue((root.parent / "assets/images/PnadDLogo.png").is_file())

        build_script = (root / "build.py").read_text(encoding="utf-8")
        self.assertIn("PnadDLogo.png", build_script)
        self.assertNotIn("PandDInstallerLogo.png", build_script)

        self.assertEqual(config_root.findtext("TitleColor"), "#ffffff")
        self.assertEqual(config_root.findtext("RunProgram"),
                         "@TargetDir@/bin/PandD Game Launcher")

    def test_stylesheet_implements_dark_theme_visual_contract(self) -> None:
        """The stylesheet must match the launcher visual language (#11151d, #151a24, #2c3442, #65a7ff)."""
        root = Path(__file__).resolve().parent
        config_root = ET.parse(root / "config/config.xml").getroot()
        stylesheet_file = root / "config" / config_root.findtext("StyleSheet")
        qss = stylesheet_file.read_text(encoding="utf-8")

        self.assertTrue(stylesheet_file.is_file())
        self.assertIn("#11151d", qss)
        self.assertIn("#151a24", qss)
        self.assertIn("#2c3442", qss)
        self.assertIn("#65a7ff", qss)
        self.assertIn("#5a9cf5", qss)
        self.assertIn("#ff6b6b", qss)
        self.assertIn("QProgressBar", qss)
        self.assertIn("QProgressBar::chunk", qss)
        self.assertIn("QPushButton:default", qss)

    def test_installer_explains_and_validates_the_final_install_path(self) -> None:
        """The target page must show the fixed child directory and detailed failures."""
        root = Path(__file__).resolve().parent
        config_root = ET.parse(root / "config/config.xml").getroot()
        control_script = root / "config" / config_root.findtext("ControlScript")
        script = control_script.read_text(encoding="utf-8")

        self.assertTrue(control_script.is_file())
        self.assertEqual(config_root.findtext("TargetDir"),
                         "@ApplicationsDir@/PandDGameLauncher")
        self.assertIn('var launcherDirectoryName = "PandDGameLauncher"', script)
        self.assertIn("ランチャーは、", script)
        self.assertIn("インストール先フォルダが空ではありません。", script)
        self.assertIn("対象: ", script)
        self.assertIn("ショートカット: ", script)
        self.assertIn('"OverwriteTargetDirectory", QMessageBox.No', script)

    def test_controlscript_uses_official_qt_ifw_apis_strictly(self) -> None:
        """Controller script must not include unsupported or ineffective IFW scripting APIs."""
        root = Path(__file__).resolve().parent
        config_root = ET.parse(root / "config/config.xml").getroot()
        control_script = root / "config" / config_root.findtext("ControlScript")
        script = control_script.read_text(encoding="utf-8")

        # Strictly forbid unsupported IFW 4.7.0 runtime APIs/methods/enums
        self.assertNotIn("gui.currentPageChanged", script, "gui.currentPageChanged is not present on Qt IFW 4.7.0 runtime")
        self.assertNotIn("gui.setWizardPageButtonText", script, "gui.setWizardPageButtonText is not present on Qt IFW 4.7.0")
        self.assertNotIn("gui.pageChanged", script, "Invalid signal 'gui.pageChanged' used")
        self.assertNotIn("QWizard.", script, "Non-scripting enum 'QWizard.*' used")
        self.assertNotIn("QInstaller.Finished", script, "Non-existent page enum 'QInstaller.Finished' used instead of 'QInstaller.InstallationFinished'")

        # Ineffective button rewriting helpers must be removed
        self.assertNotIn("setButtonLabel", script, "Ineffective button rewriting helper must not be retained")
        self.assertNotIn("page.setButtonText", script, "QWizardPage::setButtonText is not an invokable slot on Qt IFW 4.7.0")

    def test_controlscript_implements_branding_and_launcher_execution(self) -> None:
        """Controller script must manage page.entered hooks, branded titles/copies, and safe launching."""
        root = Path(__file__).resolve().parent
        config_root = ET.parse(root / "config/config.xml").getroot()
        control_script = root / "config" / config_root.findtext("ControlScript")
        script = control_script.read_text(encoding="utf-8")

        # Page entered hooks with truthy guards for headless CLI compatibility
        self.assertIn("page.entered.connect", script)
        self.assertIn("hookPageEntered", script)
        self.assertTrue(
            re.search(r"if\s*\(\s*!page\s*\|\|\s*!page\.entered\s*\)", script) is not None,
            "hookPageEntered must have a truthy guard (!page || !page.entered) to prevent TypeError on headless CLI"
        )

        # Cleaner UI: hide settings button in installer mode
        self.assertIn("gui.showSettingsButton(false)", script)

        # Action vocabulary in visual copy
        self.assertIn('"CONTINUE // インストール先を設定"', script)
        self.assertIn('"INSTALL // 準備を開始"', script)
        self.assertIn("LAUNCH // 右下の操作からランチャーを起動し、ゲームの世界へ飛び込みましょう。", script)

        # Branded page titles
        self.assertIn('"PANDD LAUNCHER"', script)
        self.assertIn('"CHOOSE YOUR DESTINATION"', script)
        self.assertIn('"LOADING PANDD LAUNCHER"', script)
        self.assertIn('"READY TO PLAY"', script)
        self.assertIn('"SETUP INCOMPLETE"', script)

        # Finished, Welcome, and Loading screen UX
        self.assertIn("READY FOR YOUR NEXT ADVENTURE", script)
        self.assertIn("PREPARING YOUR ADVENTURE...", script)

        # Cross-platform launcher execution matching e2e.py installed_launcher()
        self.assertIn('systemInfo.productType === "windows"', script)
        self.assertIn('systemInfo.productType === "osx"', script)
        self.assertIn('PandD Game Launcher.exe', script)
        self.assertIn('PandD Game Launcher.app/Contents/MacOS/PandD Game Launcher', script)
        self.assertIn('/bin/PandD Game Launcher', script)

        # Safe launch configuration and checkbox handling
        self.assertIn('installer.setValue("RunProgram", executablePath)', script)
        self.assertIn('installer.setValue("RunProgram", "")', script)
        self.assertIn('page.RunItCheckBox.setChecked(true)', script)
        self.assertIn('page.RunItCheckBox.setVisible(false)', script)

        # Required official Controller callbacks
        self.assertIn('Controller.prototype.IntroductionPageCallback', script)
        self.assertIn('Controller.prototype.TargetDirectoryPageCallback', script)
        self.assertIn('Controller.prototype.ComponentSelectionPageCallback', script)
        self.assertIn('Controller.prototype.LicenseAgreementPageCallback', script)
        self.assertIn('Controller.prototype.StartMenuDirectoryPageCallback', script)
        self.assertIn('Controller.prototype.ReadyForInstallationPageCallback', script)
        self.assertIn('Controller.prototype.PerformInstallationPageCallback', script)
        self.assertIn('Controller.prototype.FinishedPageCallback', script)

        # Ensure incorrect callback names are not present
        self.assertNotIn('LicenseCheckPageCallback', script)
        self.assertNotIn('StartMenuSelectionPageCallback', script)

        # Flow streamlining
        self.assertIn('installer.setDefaultPageVisible(QInstaller.ComponentSelection, false)', script)
        self.assertIn('installer.setDefaultPageVisible(QInstaller.ReadyForInstallation, false)', script)

        # ES5 syntax check (no let, const, arrow functions, async/await)
        self.assertIsNone(re.search(r'\bconst\s+\w+', script), "ES6 'const' found in controlscript.qs")
        self.assertIsNone(re.search(r'\blet\s+\w+', script), "ES6 'let' found in controlscript.qs")
        self.assertIsNone(re.search(r'=>', script), "ES6 arrow function found in controlscript.qs")
        self.assertIsNone(re.search(r'\basync\s+function', script), "ES6 'async' found in controlscript.qs")

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

    def test_windows_package_contains_dedicated_uninstaller(self) -> None:
        """The installed Windows layout exposes a clear uninstaller entry point."""
        root = Path(__file__).resolve().parent.parent
        cmake = (root / "CMakeLists.txt").read_text(encoding="utf-8")
        source = root / "client/src/uninstaller/UninstallerMain.cpp"

        self.assertTrue(source.is_file())
        self.assertIn('OUTPUT_NAME "Uninstall PandD Game Launcher"', cmake)
        self.assertIn("install(TARGETS PandDUninstaller RUNTIME DESTINATION .)", cmake)
        self.assertIn('L"maintenancetool.exe"', source.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
