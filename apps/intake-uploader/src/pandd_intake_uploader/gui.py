"""PySide6 wizard for preparing a game intake artifact."""

from __future__ import annotations

from pathlib import Path
import sys

from PySide6.QtCore import QObject, QRunnable, Qt, QThreadPool, Signal, Slot
from PySide6.QtGui import QColor, QPalette, QPixmap
from PySide6.QtWidgets import (
    QApplication, QComboBox, QDoubleSpinBox, QFileDialog, QFormLayout, QGridLayout,
    QHBoxLayout, QLabel, QLineEdit, QMessageBox, QPlainTextEdit, QProgressBar,
    QPushButton, QScrollArea, QTableWidget, QTableWidgetItem, QVBoxLayout, QWidget, QWizard,
    QWizardPage,
)

from pandd_intake_uploader.application import (
    ArtifactCancelled, ArtifactService, CancellationToken, IntakeSettings, ReleaseDraft,
    Translation, ValidationError, validate_draft,
)
from pandd_intake_uploader.intake_client import IntakeClient


def help_label(text: str, tip: str) -> QLabel:
    """Create a required-field label whose hover help is useful to first-time publishers."""
    label = QLabel(text)
    label.setToolTip(f"<div style='max-width: 360px'>{tip}</div>")
    return label


def set_missing_style(widget: QWidget, missing: bool) -> None:
    """Highlight an empty required input without relying on the system palette."""
    widget.setStyleSheet("border: 2px solid #d92d20;" if missing else "")


class WorkerSignals(QObject):
    progress = Signal(int, str, str)
    succeeded = Signal(str)
    failed = Signal(str)
    cancelled = Signal(str)


class ArtifactWorker(QRunnable):
    def __init__(self, service: ArtifactService, draft: ReleaseDraft):
        super().__init__()
        self.service = service
        self.draft = draft
        self.signals = WorkerSignals()
        self.cancellation = CancellationToken()

    def request_cancel(self) -> bool:
        return self.cancellation.request()

    @Slot()
    def run(self) -> None:
        try:
            def artifact_progress(percent: int, stage: str, detail: str) -> None:
                self.signals.progress.emit(round(percent * 0.85), stage, detail)

            result = self.service.create(
                self.draft, artifact_progress, self.cancellation)
            IntakeClient(self.service.settings.control_plane_url).upload(
                result.descriptor_path, self.signals.progress.emit, self.cancellation,
            )
        except ArtifactCancelled as error:
            self.signals.cancelled.emit(str(error))
        except Exception as error:  # Qt worker boundary converts failures to a user result.
            self.signals.failed.emit(str(error))
        else:
            self.signals.succeeded.emit(str(result.descriptor_path))


class SetupPage(QWizardPage):
    def __init__(self, settings: IntakeSettings | None, settings_error: str):
        super().__init__()
        self.setTitle("Intake artifact出力先の確認")
        self.setSubTitle("署名鍵やR2認証情報を使わず、申請用artifactをローカルに作成します。")
        layout = QVBoxLayout(self)
        self.status = QLabel()
        self.status.setWordWrap(True)
        layout.addWidget(self.status)
        self.recheck = QPushButton("出力先を再確認")
        self.recheck.clicked.connect(self._refresh)
        layout.addWidget(self.recheck)
        layout.addStretch()
        self._settings = settings
        self._settings_error = settings_error
        self._complete = False
        self._refresh()

    def _refresh(self) -> None:
        if self._settings_error:
            self.status.setText("設定を読み込めません。\n" + self._settings_error)
            self.status.setStyleSheet("color: #b42318")
            self._complete = False
        elif self._settings:
            problems = self._settings.validate_output()
            lines = [
                f"artifact出力先: {self._settings.output_root}",
                f"control plane: {self._settings.control_plane_url}",
            ]
            lines.append("\n".join(problems) if problems else "出力先へ安全に書き込めます。")
            self.status.setText("\n".join(lines))
            self.status.setStyleSheet("color: #b42318" if problems else "color: #067647")
            self._complete = not problems
        self.completeChanged.emit()

    def isComplete(self) -> bool:
        return self._complete


class BuildPage(QWizardPage):
    def __init__(self):
        super().__init__()
        self.setTitle("ゲームビルドを選択")
        self.setSubTitle("Unityなどのビルド全体を含むフォルダと、その中の起動exeを選びます。")
        outer = QVBoxLayout(self)
        layout = QFormLayout()
        self.build = QLineEdit()
        self.executable = QLineEdit()
        build_tip = (
            "ゲームを起動するために必要なファイル一式が入っているフォルダです。"
            "Unityの場合は、ゲームのexe、同名の「_Data」フォルダ、UnityPlayer.dllなどが"
            "一緒に入っているビルド出力フォルダを選びます。例: D:/Games/PixelPile_Build"
        )
        executable_tip = (
            "プレイヤーが起動するゲーム本体のexeです。UnityCrashHandler64.exeなどの補助exeではなく、"
            "ゲーム名のexeを選びます。必ず上のビルドフォルダ内にあるexeを選んでください。"
        )
        self.build.setToolTip(build_tip)
        self.executable.setToolTip(executable_tip)
        layout.addRow(help_label("ビルドフォルダ *", build_tip),
                      self._path_row(self.build, False, build_tip))
        layout.addRow(help_label("起動exe *", executable_tip),
                      self._path_row(self.executable, True, executable_tip))
        outer.addLayout(layout)
        self.status = QLabel()
        self.status.setWordWrap(True)
        outer.addWidget(self.status)
        outer.addStretch()
        self.build.textChanged.connect(self._update_state)
        self.executable.textChanged.connect(self._update_state)
        self._update_state()

    def _path_row(self, target: QLineEdit, executable: bool, tip: str):
        row = QWidget()
        row.setToolTip(tip)
        layout = QHBoxLayout(row)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(target)
        button = QPushButton("参照")
        button.setToolTip(tip)
        layout.addWidget(button)

        def browse() -> None:
            if executable:
                value, _ = QFileDialog.getOpenFileName(self, "起動exe", self.build.text(),
                                                       "Windows executable (*.exe)")
            else:
                value = QFileDialog.getExistingDirectory(self, "ビルドフォルダ", target.text())
            if value:
                target.setText(value)
        button.clicked.connect(browse)
        return row

    def validation_errors(self) -> list[str]:
        errors: list[str] = []
        build_text = self.build.text().strip()
        executable_text = self.executable.text().strip()
        if not build_text:
            errors.append("ビルドフォルダを選択してください")
        elif not Path(build_text).is_dir():
            errors.append("選択したビルドフォルダが見つかりません")
        if not executable_text:
            errors.append("起動exeを選択してください")
        elif not Path(executable_text).is_file() or Path(executable_text).suffix.lower() != ".exe":
            errors.append("選択した起動exeが見つからないか、exeではありません")
        if not errors and build_text and executable_text:
            try:
                Path(executable_text).resolve().relative_to(Path(build_text).resolve())
            except ValueError:
                errors.append("起動exeはビルドフォルダ内にあるものを選択してください")
        return errors

    def _update_state(self, *_: object) -> None:
        errors = self.validation_errors()
        set_missing_style(self.build, not self.build.text().strip())
        set_missing_style(self.executable, not self.executable.text().strip())
        if errors:
            self.status.setText("入力を確認してください:\n・" + "\n・".join(errors))
            self.status.setStyleSheet("color: #b42318")
        else:
            self.status.setText("ビルドフォルダと起動exeを確認しました。「次へ」を押してください。")
            self.status.setStyleSheet("color: #067647")
        self.completeChanged.emit()

    def isComplete(self) -> bool:
        return not self.validation_errors()


class MetadataPage(QWizardPage):
    def __init__(self):
        super().__init__()
        self.setTitle("ゲーム情報を入力")
        self.setSubTitle("日本語は必須です。必要に応じて言語行を追加できます。")
        page_layout = QVBoxLayout(self)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        content = QWidget()
        outer = QVBoxLayout(content)
        scroll.setWidget(content)
        page_layout.addWidget(scroll)
        form = QFormLayout()
        self.game_id = QLineEdit()
        self.version = QLineEdit("1.0.0")
        self.minimum = QLineEdit("1.0.1")
        self.engine = QComboBox()
        self.engine.addItems(["unity", "godot", "siv3d"])
        self.save_name = QLineEdit()
        tips = {
            "game_id": (
                "このゲームを区別するための変更しないIDです。英小文字、数字、ハイフンだけで"
                "3～64文字にします。公開後は変更しません。例: pixel-pile"
            ),
            "version": (
                "今回公開するゲームのバージョンです。「メジャー.マイナー.修正」の3つの数字で"
                "入力します。内容を更新するたびに増やします。例: 1.0.0 → 1.0.1"
            ),
            "minimum": (
                "このゲームを扱える最も古いランチャーのバージョンです。通常は現在配布している"
                "ランチャーのバージョンを入力します。分からない場合は既定値のままにします。"
            ),
            "engine": "ゲームをビルドしたエンジンを選びます。Unityで作った場合は unity です。",
            "save": (
                "セーブデータ用フォルダの名前です。英数字、_、-だけで2～64文字にします。"
                "ゲームIDに近い名前がおすすめです。例: PixelPile"
            ),
        }
        for widget, key in ((self.game_id, "game_id"), (self.version, "version"),
                            (self.minimum, "minimum"), (self.engine, "engine"),
                            (self.save_name, "save")):
            widget.setToolTip(f"<div style='max-width: 360px'>{tips[key]}</div>")
        form.addRow(help_label("ゲームID *", tips["game_id"]), self.game_id)
        form.addRow(help_label("バージョン *", tips["version"]), self.version)
        form.addRow(help_label("最小ランチャーバージョン *", tips["minimum"]), self.minimum)
        form.addRow(help_label("ゲームエンジン *", tips["engine"]), self.engine)
        form.addRow(help_label("セーブディレクトリ名 *", tips["save"]), self.save_name)
        outer.addLayout(form)

        translation_tip = (
            "ランチャーに表示するゲーム名と短い説明です。日本語（ja-JP）は必須です。"
            "ほかの言語は「言語を追加」から追加できます。"
        )
        outer.addWidget(help_label("言語別のゲーム名・説明 *", translation_tip))
        self.translations = QTableWidget(1, 3)
        self.translations.setMinimumHeight(150)
        self.translations.setHorizontalHeaderLabels(["言語タグ", "ゲーム名", "説明"])
        self.translations.setItem(0, 0, QTableWidgetItem("ja-JP"))
        self.translations.item(0, 0).setFlags(
            self.translations.item(0, 0).flags() & ~Qt.ItemIsEditable)
        header_tips = [
            "言語を表すBCP 47タグです。例: ja-JP、en-US、ko-KR、zh-Hans",
            "ランチャーの一覧に表示するゲーム名です。100文字以内で入力します。",
            "どんなゲームか分かる短い説明です。500文字以内で入力します。",
        ]
        for column, tip in enumerate(header_tips):
            self.translations.horizontalHeaderItem(column).setToolTip(tip)
        self.translations.setToolTip(translation_tip)
        self.translations.horizontalHeader().setStretchLastSection(True)
        outer.addWidget(self.translations)
        translation_buttons = QHBoxLayout()
        add_translation = QPushButton("言語を追加")
        remove_translation = QPushButton("選択言語を削除")
        translation_buttons.addWidget(add_translation)
        translation_buttons.addWidget(remove_translation)
        translation_buttons.addStretch()
        outer.addLayout(translation_buttons)
        add_translation.clicked.connect(self._add_translation)
        remove_translation.clicked.connect(self._remove_translation)

        image_form = QFormLayout()
        self.hero = QLineEdit()
        self.thumbnail = QLineEdit()
        hero_tip = (
            "ゲーム詳細画面の大きな背景に使う横長画像です。PNG、JPEG、WebPから選びます。"
            "ゲーム名や重要な絵が中央付近にある画像がおすすめです。"
        )
        thumbnail_tip = (
            "ゲーム一覧の小さなカードに使う画像です。PNG、JPEG、WebPから選びます。"
        )
        self.hero.setToolTip(hero_tip)
        self.thumbnail.setToolTip(thumbnail_tip)
        image_form.addRow(help_label("hero画像 *", hero_tip), self._image_row(self.hero, hero_tip))
        image_form.addRow(help_label("thumbnail画像 *", thumbnail_tip),
                          self._image_row(self.thumbnail, thumbnail_tip))
        self.focal_x = QDoubleSpinBox()
        self.focal_y = QDoubleSpinBox()
        for spin in (self.focal_x, self.focal_y):
            spin.setRange(0, 1)
            spin.setSingleStep(0.05)
            spin.setValue(0.5)
        focal = QWidget()
        focal_layout = QHBoxLayout(focal)
        focal_layout.setContentsMargins(0, 0, 0, 0)
        focal_layout.addWidget(QLabel("X"))
        focal_layout.addWidget(self.focal_x)
        focal_layout.addWidget(QLabel("Y"))
        focal_layout.addWidget(self.focal_y)
        focal_tip = (
            "画像を画面サイズに合わせて切り抜くとき、残したい中心位置です。Xは左0～右1、"
            "Yは上0～下1です。分からない場合は中央の0.5、0.5のままにします。"
        )
        focal.setToolTip(focal_tip)
        image_form.addRow(help_label("hero焦点", focal_tip), focal)
        outer.addLayout(image_form)

        self.required_status = QLabel()
        self.required_status.setWordWrap(True)
        outer.addWidget(self.required_status)
        for edit in (self.game_id, self.version, self.minimum, self.save_name,
                     self.hero, self.thumbnail):
            edit.textChanged.connect(self._update_required_state)
        self.translations.itemChanged.connect(self._update_required_state)
        self._update_required_state()

    def _image_row(self, target: QLineEdit, tip: str):
        row = QWidget()
        row.setToolTip(tip)
        layout = QHBoxLayout(row)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(target)
        button = QPushButton("参照")
        button.setToolTip(tip)
        layout.addWidget(button)
        button.clicked.connect(lambda: self._browse_image(target))
        return row

    def _browse_image(self, target: QLineEdit) -> None:
        value, _ = QFileDialog.getOpenFileName(
            self, "画像を選択", target.text(), "Images (*.png *.jpg *.jpeg *.webp)")
        if value:
            target.setText(value)

    def _add_translation(self) -> None:
        self.translations.insertRow(self.translations.rowCount())
        self._update_required_state()

    def _remove_translation(self) -> None:
        row = self.translations.currentRow()
        if row >= 0 and self.translations.item(row, 0) and \
                self.translations.item(row, 0).text() != "ja-JP":
            self.translations.removeRow(row)
            self._update_required_state()

    def missing_required_fields(self) -> list[str]:
        missing: list[str] = []
        for label, edit in (("ゲームID", self.game_id), ("バージョン", self.version),
                            ("最小ランチャーバージョン", self.minimum),
                            ("セーブディレクトリ名", self.save_name),
                            ("hero画像", self.hero), ("thumbnail画像", self.thumbnail)):
            if not edit.text().strip():
                missing.append(label)
        japanese_name = self.translations.item(0, 1)
        japanese_summary = self.translations.item(0, 2)
        if not japanese_name or not japanese_name.text().strip():
            missing.append("日本語のゲーム名")
        if not japanese_summary or not japanese_summary.text().strip():
            missing.append("日本語の説明")
        return missing

    def _update_required_state(self, *_: object) -> None:
        missing = self.missing_required_fields()
        for edit in (self.game_id, self.version, self.minimum, self.save_name,
                     self.hero, self.thumbnail):
            set_missing_style(edit, not edit.text().strip())
        if missing:
            self.required_status.setText("未入力の必須項目:\n・" + "\n・".join(missing))
            self.required_status.setStyleSheet("color: #b42318")
        else:
            self.required_status.setText("必須項目はすべて入力されています。")
            self.required_status.setStyleSheet("color: #067647")
        self.completeChanged.emit()

    def isComplete(self) -> bool:
        return not self.missing_required_fields()

    def translation_values(self) -> dict[str, Translation]:
        values: dict[str, Translation] = {}
        for row in range(self.translations.rowCount()):
            cells = [self.translations.item(row, column) for column in range(3)]
            locale, name, summary = [cell.text().strip() if cell else "" for cell in cells]
            if locale or name or summary:
                if locale in values:
                    raise ValidationError(f"言語タグが重複しています: {locale}")
                values[locale] = Translation(name, summary)
        return values


class ReviewPage(QWizardPage):
    def __init__(self):
        super().__init__()
        self.setTitle("Artifact内容を確認")
        self.setSubTitle("ローカルartifactを作成し、非公開intakeへuploadします。公開環境は変更しません。")
        layout = QVBoxLayout(self)
        self.summary = QPlainTextEdit()
        self.summary.setReadOnly(True)
        layout.addWidget(self.summary)
        self.confirm_help = QLabel(
            "内容に間違いがなければ、下の確認ボタンを押してください。確認後にFinishが有効になります。"
        )
        self.confirm_help.setWordWrap(True)
        self.confirm_help.setStyleSheet("color: #175cd3; font-weight: 600")
        layout.addWidget(self.confirm_help)
        self.progress_stage = QLabel("artifact作成を待っています")
        self.progress_stage.setStyleSheet("font-weight: 600")
        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setFormat("%p%")
        self.progress_detail = QLabel()
        self.progress_detail.setWordWrap(True)
        for widget in (self.progress_stage, self.progress_bar, self.progress_detail):
            widget.setVisible(False)
            layout.addWidget(widget)
        self.confirm = QPushButton("[未確認] この内容でartifact作成を確認する")
        self.confirm.setCheckable(True)
        self.confirm.setAccessibleName("artifact作成の最終確認")
        self.confirm.setToolTip(
            "誤操作防止の最終確認です。このボタンを押すとFinishが有効になります。"
        )
        self.confirm.toggled.connect(self._confirmation_changed)
        layout.addWidget(self.confirm)
        self.cancel_publish = QPushButton("作成をキャンセル")
        self.cancel_publish.setAccessibleName("進行中のartifact作成をキャンセル")
        self.cancel_publish.setToolTip(
            "現在処理中のファイルが終わった時点で停止し、未完成のartifactを削除します。"
        )
        self.cancel_publish.setStyleSheet(
            "color: #b42318; border: 2px solid #d92d20; font-weight: 600;"
        )
        self.cancel_publish.setVisible(False)
        layout.addWidget(self.cancel_publish)

    def _confirmation_changed(self, checked: bool) -> None:
        self.confirm.setText(
            "[確認済み] Finishを押すとartifactを作成します"
            if checked else "[未確認] この内容でartifact作成を確認する"
        )
        self.confirm.setStyleSheet(
            "color: #ffffff; background-color: #067647; border: 2px solid #067647;"
            if checked else ""
        )
        self.completeChanged.emit()

    def initializePage(self) -> None:
        try:
            draft = self.wizard().draft()
            preview = validate_draft(draft)
            self.summary.setPlainText(
                f"ゲーム: {draft.game_id}  {draft.version}\n"
                f"起動exe: {preview.entrypoint}\n"
                f"ファイル: {preview.files:,}件\n"
                f"合計容量: {preview.total_bytes / (1024 ** 2):,.1f} MiB\n"
                f"言語: {', '.join(preview.locales)}\n"
                f"出力先: {self.wizard().settings.output_root}"
            )
        except Exception as error:
            self.summary.setPlainText(str(error))
        self.confirm.setChecked(False)
        self.progress_bar.setValue(0)
        self.progress_stage.setText("artifact作成を待っています")
        self.progress_detail.clear()
        for widget in (self.progress_stage, self.progress_bar, self.progress_detail):
            widget.setVisible(False)
        self.cancel_publish.setVisible(False)
        self.cancel_publish.setEnabled(True)

    def isComplete(self) -> bool:
        return self.confirm.isChecked()


class MaintenanceWizard(QWizard):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("PandD Intake Artifact Uploader")
        self.setMinimumSize(820, 650)
        self.setStyleSheet("""
            QWidget { color: #17202a; background-color: #f7f8fa; }
            QWizardPage { background-color: #ffffff; }
            QLabel { color: #17202a; background-color: transparent; }
            QLineEdit, QPlainTextEdit, QTableWidget, QComboBox, QDoubleSpinBox {
                color: #17202a; background-color: #ffffff; border: 1px solid #98a2b3;
                border-radius: 4px; padding: 5px;
            }
            QPushButton {
                color: #17202a; background-color: #ffffff; border: 1px solid #667085;
                border-radius: 5px; padding: 6px 14px;
            }
            QPushButton:hover { background-color: #eef4ff; border-color: #175cd3; }
            QPushButton:disabled { color: #667085; background-color: #e4e7ec; border-color: #d0d5dd; }
            QHeaderView::section { color: #17202a; background-color: #eaecf0; padding: 5px; }
            QProgressBar {
                color: #17202a; background-color: #eaecf0; border: 1px solid #98a2b3;
                border-radius: 5px; min-height: 22px; text-align: center;
            }
            QProgressBar::chunk { background-color: #175cd3; border-radius: 4px; }
        """)
        try:
            self.settings = IntakeSettings.from_environment()
            settings_error = ""
        except ValidationError as error:
            self.settings = None
            settings_error = str(error)
        self.setup_page = SetupPage(self.settings, settings_error)
        self.build_page = BuildPage()
        self.metadata_page = MetadataPage()
        self.review_page = ReviewPage()
        for page in (self.setup_page, self.build_page, self.metadata_page, self.review_page):
            self.addPage(page)
        self.thread_pool = QThreadPool(self)
        self._publishing = False
        self._worker: ArtifactWorker | None = None
        self.review_page.cancel_publish.clicked.connect(self._request_cancel)

    def draft(self) -> ReleaseDraft:
        page = self.metadata_page
        return ReleaseDraft(
            Path(self.build_page.build.text()), Path(self.build_page.executable.text()),
            page.game_id.text().strip(), page.version.text().strip(), page.minimum.text().strip(),
            page.engine.currentText(), page.save_name.text().strip(), page.translation_values(),
            Path(page.hero.text()), Path(page.thumbnail.text()),
            page.focal_x.value(), page.focal_y.value(),
        )

    def validateCurrentPage(self) -> bool:
        if self.currentPage() in (self.build_page, self.metadata_page):
            try:
                # Full validation occurs when leaving metadata; build selection gets basic checks.
                if self.currentPage() is self.metadata_page:
                    validate_draft(self.draft())
            except ValidationError as error:
                QMessageBox.warning(self, "入力内容を確認してください", str(error))
                return False
        return super().validateCurrentPage()

    def accept(self) -> None:
        if self._publishing or not self.settings:
            return
        try:
            draft = self.draft()
            validate_draft(draft)
        except ValidationError as error:
            QMessageBox.warning(self, "artifactを作成できません", str(error))
            return
        self._publishing = True
        self.setOption(QWizard.DisabledBackButtonOnLastPage, True)
        for button in (self.button(QWizard.BackButton), self.button(QWizard.FinishButton),
                       self.button(QWizard.CancelButton)):
            button.setEnabled(False)
        self.review_page.confirm.setEnabled(False)
        self.review_page.confirm_help.setText(
            "artifact作成中です。このウィンドウを閉じずに完了までお待ちください。"
        )
        self.review_page.progress_bar.setValue(0)
        self.review_page.progress_stage.setStyleSheet("font-weight: 600")
        self.review_page.progress_stage.setText("artifact作成を開始しています")
        self.review_page.progress_detail.clear()
        for widget in (self.review_page.progress_stage, self.review_page.progress_bar,
                       self.review_page.progress_detail):
            widget.setVisible(True)
        self.review_page.cancel_publish.setVisible(True)
        self.review_page.cancel_publish.setEnabled(True)
        self.review_page.summary.appendPlainText("\nartifact作成を開始しました…")
        worker = ArtifactWorker(ArtifactService(self.settings), draft)
        worker.signals.progress.connect(self._progress_changed)
        worker.signals.succeeded.connect(self._succeeded)
        worker.signals.failed.connect(self._failed)
        worker.signals.cancelled.connect(self._cancelled)
        self._worker = worker
        self.thread_pool.start(worker)

    @Slot(int, str, str)
    def _progress_changed(self, percent: int, stage: str, detail: str) -> None:
        previous_stage = self.review_page.progress_stage.text()
        self.review_page.progress_bar.setValue(max(0, min(100, percent)))
        self.review_page.progress_stage.setText(stage)
        self.review_page.progress_detail.setText(detail)
        if stage != previous_stage:
            self.review_page.summary.appendPlainText(stage)

    @Slot()
    def _request_cancel(self) -> None:
        if not self._publishing or not self._worker:
            return
        answer = QMessageBox.question(
            self, "artifact作成をキャンセルしますか？",
            "現在処理中のファイルが終わり次第停止し、未完成のartifactを削除します。",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
        if answer != QMessageBox.Yes:
            return
        if not self._worker.request_cancel():
            QMessageBox.information(
                self, "キャンセルできません", "artifact作成を停止できませんでした。")
            return
        self.review_page.cancel_publish.setEnabled(False)
        self.review_page.progress_stage.setText("キャンセルを要求しました")
        self.review_page.progress_detail.setText(
            "現在処理中のファイルが終わり次第、安全に停止します")
        self.review_page.summary.appendPlainText("\nartifact作成のキャンセルを要求しました…")

    @Slot(str)
    def _succeeded(self, descriptor: str) -> None:
        self.review_page.cancel_publish.setVisible(False)
        QMessageBox.information(
            self, "Artifact作成完了",
            "artifactを非公開intakeへuploadし、sealしました。\n"
            "control planeの新しい申請でdescriptorを選択してください。\n\n" + descriptor,
        )
        super().accept()

    @Slot(str)
    def _cancelled(self, message: str) -> None:
        self._publishing = False
        self._worker = None
        self.review_page.summary.appendPlainText("\nキャンセル済み: " + message)
        self.review_page.confirm.setEnabled(True)
        self.review_page.cancel_publish.setVisible(False)
        self.review_page.progress_stage.setText("artifact作成をキャンセルしました")
        self.review_page.progress_stage.setStyleSheet("color: #b54708; font-weight: 600")
        self.review_page.progress_detail.setText(
            "未完成のローカルartifactを削除しました。R2や公開環境は変更していません。")
        self.review_page.confirm_help.setText("内容を確認して、必要なら再度作成できます。")
        for button in (self.button(QWizard.BackButton), self.button(QWizard.FinishButton),
                       self.button(QWizard.CancelButton)):
            button.setEnabled(True)
        QMessageBox.information(self, "artifact作成をキャンセルしました", message)

    @Slot(str)
    def _failed(self, message: str) -> None:
        self._publishing = False
        self.review_page.summary.appendPlainText("\n失敗: " + message)
        self.review_page.confirm.setEnabled(True)
        self.review_page.cancel_publish.setVisible(False)
        self.review_page.progress_stage.setText("artifact作成に失敗しました")
        self.review_page.progress_stage.setStyleSheet("color: #b42318; font-weight: 600")
        self.review_page.progress_detail.setText(message)
        self.review_page.confirm_help.setText(
            "入力内容や環境を確認して再試行してください。"
        )
        for button in (self.button(QWizard.BackButton), self.button(QWizard.FinishButton),
                       self.button(QWizard.CancelButton)):
            button.setEnabled(True)
        QMessageBox.critical(self, "artifact作成に失敗しました", message)

    def reject(self) -> None:
        if self._publishing:
            self._request_cancel()
            return
        super().reject()


def apply_light_theme(application: QApplication) -> None:
    """Use deterministic accessible colors independent of the Windows system theme."""
    application.setStyle("Fusion")
    palette = QPalette()
    palette.setColor(QPalette.Window, QColor("#f7f8fa"))
    palette.setColor(QPalette.WindowText, QColor("#17202a"))
    palette.setColor(QPalette.Base, QColor("#ffffff"))
    palette.setColor(QPalette.AlternateBase, QColor("#f2f4f7"))
    palette.setColor(QPalette.Text, QColor("#17202a"))
    palette.setColor(QPalette.Button, QColor("#ffffff"))
    palette.setColor(QPalette.ButtonText, QColor("#17202a"))
    palette.setColor(QPalette.Highlight, QColor("#175cd3"))
    palette.setColor(QPalette.HighlightedText, QColor("#ffffff"))
    palette.setColor(QPalette.Disabled, QPalette.Text, QColor("#667085"))
    palette.setColor(QPalette.Disabled, QPalette.ButtonText, QColor("#667085"))
    application.setPalette(palette)


def run() -> int:
    application = QApplication(sys.argv)
    apply_light_theme(application)
    application.setOrganizationName("PandD_org")
    application.setApplicationName("PandDIntakeUploader")
    wizard = MaintenanceWizard()
    wizard.show()
    return application.exec()
