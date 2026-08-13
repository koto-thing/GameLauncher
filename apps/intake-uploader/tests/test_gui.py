"""Headless checks for wizard completion state and beginner guidance."""

from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from pandd_intake_uploader.gui import BuildPage, MetadataPage, ReviewPage, apply_light_theme


class MaintenanceGuiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.application = QApplication.instance() or QApplication([])
        apply_light_theme(cls.application)

    def test_build_page_accepts_executable_at_selected_build_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            build = Path(temporary)
            executable = build / "PixelPile.exe"
            executable.write_bytes(b"game")
            page = BuildPage()
            page.build.setText(str(build))
            page.executable.setText(str(executable))
            self.assertTrue(page.isComplete())
            self.assertIn("確認しました", page.status.text())

    def test_build_page_lists_missing_fields(self) -> None:
        page = BuildPage()
        self.assertFalse(page.isComplete())
        self.assertIn("ビルドフォルダ", page.status.text())
        self.assertIn("起動exe", page.status.text())

    def test_metadata_page_lists_required_fields_and_has_help(self) -> None:
        page = MetadataPage()
        self.assertFalse(page.isComplete())
        self.assertIn("ゲームID", page.required_status.text())
        self.assertIn("日本語のゲーム名", page.required_status.text())
        self.assertIn("公開後は変更しません", page.game_id.toolTip())
        self.assertIn("1.0.0", page.version.toolTip())

    def test_review_requires_an_explicit_visible_confirmation(self) -> None:
        page = ReviewPage()
        self.assertFalse(page.isComplete())
        self.assertIn("未確認", page.confirm.text())
        page.confirm.click()
        self.assertTrue(page.isComplete())
        self.assertIn("確認済み", page.confirm.text())
        self.assertEqual(page.progress_bar.minimum(), 0)
        self.assertEqual(page.progress_bar.maximum(), 100)
        self.assertEqual(page.cancel_publish.text(), "作成をキャンセル")
        self.assertFalse(page.cancel_publish.isVisible())


if __name__ == "__main__":
    unittest.main()
