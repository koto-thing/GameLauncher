"""Validated application layer for the desktop intake uploader."""

from __future__ import annotations

from dataclasses import dataclass, field
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import threading
from typing import Callable
import uuid
import zipfile

from publisher.publisher import validate_contract, validate_locale_tag


VERSION_PATTERN = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
GAME_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")
SAVE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
MAX_ARTIFACT_BYTES = 5 * 1024 * 1024 * 1024
MAX_ARTIFACT_FILES = 50_000
MAX_ARCHIVE_PATH_LENGTH = 240
DEFAULT_CONTROL_PLANE_URL = "https://pandd-deployment-control-plane.gotoukenta62.workers.dev"
WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}


class ValidationError(ValueError):
    """An actionable input or staging-configuration error."""


class ArtifactCancelled(RuntimeError):
    """Raised when local artifact creation is cancelled."""


class CancellationToken:
    """Coordinate cancellation of local artifact creation."""

    def __init__(self) -> None:
        self._requested = threading.Event()
    def request(self) -> bool:
        self._requested.set()
        return True

    def is_requested(self) -> bool:
        return self._requested.is_set()

    def wait(self, timeout: float) -> bool:
        return self._requested.wait(timeout)

@dataclass(frozen=True)
class Translation:
    name: str
    summary: str


@dataclass(frozen=True)
class ReleaseDraft:
    build_directory: Path
    executable: Path
    game_id: str
    version: str
    minimum_launcher_version: str
    engine: str
    save_directory_name: str
    translations: dict[str, Translation]
    hero: Path
    thumbnail: Path
    focal_x: float = 0.5
    focal_y: float = 0.5


@dataclass(frozen=True)
class IntakeSettings:
    output_root: Path
    control_plane_url: str

    @classmethod
    def from_environment(cls, root: Path | None = None) -> "IntakeSettings":
        default_output = root or Path.home() / "Documents" / "PandD" / "Intake Artifacts"
        output = os.environ.get("PANDD_INTAKE_OUTPUT")
        output_root = Path(output) if output else default_output
        if not output_root.is_absolute():
            output_root = Path.cwd() / output_root
        control_plane_url = os.environ.get(
            "PANDD_CONTROL_PLANE_URL", DEFAULT_CONTROL_PLANE_URL
        ).rstrip("/")
        return cls(output_root.resolve(), control_plane_url)

    def validate_output(self) -> list[str]:
        problems: list[str] = []
        try:
            self.output_root.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=self.output_root, delete=True):
                pass
        except OSError:
            problems.append("artifact出力先へ書き込めません")
        if not (self.control_plane_url.startswith("https://") or
                self.control_plane_url.startswith("http://localhost:") or
                self.control_plane_url.startswith("http://127.0.0.1:")):
            problems.append("control plane URLはHTTPSまたはlocalhostを指定してください")
        return problems


@dataclass(frozen=True)
class ReleasePreview:
    files: int
    total_bytes: int
    entrypoint: str
    working_directory: str
    locales: tuple[str, ...]


def _relative_launch_paths(draft: ReleaseDraft) -> tuple[str, str]:
    build = draft.build_directory.resolve()
    executable = draft.executable.resolve()
    try:
        relative = executable.relative_to(build).as_posix()
    except ValueError as error:
        raise ValidationError("起動exeはビルドフォルダ内から選択してください") from error
    parent = Path(relative).parent.as_posix()
    return relative, parent


def validate_draft(draft: ReleaseDraft) -> ReleasePreview:
    errors: list[str] = []
    if not draft.build_directory.is_dir():
        errors.append("ビルドフォルダが見つかりません")
    if not draft.executable.is_file() or draft.executable.suffix.lower() != ".exe":
        errors.append("Windowsの起動exeを選択してください")
    if not GAME_ID_PATTERN.fullmatch(draft.game_id):
        errors.append("ゲームIDは3～64文字の英小文字・数字・ハイフンで入力してください")
    if not VERSION_PATTERN.fullmatch(draft.version):
        errors.append("バージョンは1.2.3形式で入力してください")
    if not VERSION_PATTERN.fullmatch(draft.minimum_launcher_version):
        errors.append("最小ランチャーバージョンは1.2.3形式で入力してください")
    if draft.engine not in {"unity", "godot", "siv3d"}:
        errors.append("対応するゲームエンジンを選択してください")
    if not SAVE_NAME_PATTERN.fullmatch(draft.save_directory_name):
        errors.append("セーブディレクトリ名は2～64文字の英数字・_・-で入力してください")
    if "ja-JP" not in draft.translations:
        errors.append("日本語のゲーム名と説明は必須です")
    for locale, translation in draft.translations.items():
        try:
            validate_locale_tag(locale)
        except ValueError:
            errors.append(f"言語タグが不正です: {locale}")
        if not 1 <= len(translation.name) <= 100 or not 1 <= len(translation.summary) <= 500:
            errors.append(f"{locale}の名前または説明の文字数が範囲外です")
    for label, image in (("hero", draft.hero), ("thumbnail", draft.thumbnail)):
        if not image.is_file() or image.suffix.lower() not in IMAGE_SUFFIXES:
            errors.append(f"{label}画像にはPNG、JPEG、WebPを指定してください")
    if not 0 <= draft.focal_x <= 1 or not 0 <= draft.focal_y <= 1:
        errors.append("hero焦点位置は0から1の範囲で指定してください")
    try:
        entrypoint, working_directory = _relative_launch_paths(draft)
    except ValidationError as error:
        errors.append(str(error))
        entrypoint, working_directory = "", ""
    files = [path for path in draft.build_directory.rglob("*") if path.is_file()]
    if not files:
        errors.append("ビルドフォルダにファイルがありません")
    if len(files) > MAX_ARTIFACT_FILES:
        errors.append("ビルドに含められるファイル数は50,000件までです")
    total_bytes = sum(path.stat().st_size for path in files)
    if total_bytes > MAX_ARTIFACT_BYTES:
        errors.append("ビルドの合計容量は5 GiB以下にしてください")
    if any(path.stat().st_size == 0 for path in files):
        errors.append("空ファイルはartifactに含められません")
    if errors:
        raise ValidationError("\n".join(errors))
    return ReleasePreview(len(files), total_bytes, entrypoint,
                          working_directory, tuple(sorted(draft.translations)))


def create_metadata(draft: ReleaseDraft, metadata_directory: Path) -> Path:
    preview = validate_draft(draft)
    metadata_directory.mkdir(parents=True, exist_ok=False)
    hero_name = "hero" + draft.hero.suffix.lower()
    thumbnail_name = "thumbnail" + draft.thumbnail.suffix.lower()
    shutil.copy2(draft.hero, metadata_directory / hero_name)
    shutil.copy2(draft.thumbnail, metadata_directory / thumbnail_name)
    document = {
        "gameId": draft.game_id,
        "version": draft.version,
        "minimumLauncherVersion": draft.minimum_launcher_version,
        "publishedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
            .isoformat().replace("+00:00", "Z"),
        "engine": draft.engine,
        "entrypoint": preview.entrypoint,
        "workingDirectory": preview.working_directory,
        "saveDirectoryName": draft.save_directory_name,
        "display": {locale: {"name": value.name, "summary": value.summary}
                    for locale, value in sorted(draft.translations.items())},
        "hero": hero_name,
        "heroFocalPoint": {"x": draft.focal_x, "y": draft.focal_y},
        "thumbnail": thumbnail_name,
    }
    validate_contract(document, "game-release-source.schema.json")
    path = metadata_directory / "release.json"
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


@dataclass(frozen=True)
class ArtifactResult:
    artifact_id: str
    archive_path: Path
    descriptor_path: Path
    sha256: str
    size_bytes: int
    file_count: int


def _is_reparse_point(path: Path) -> bool:
    attributes = getattr(path.lstat(), "st_file_attributes", 0)
    return bool(attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))


def _validate_archive_path(relative: Path) -> str:
    value = relative.as_posix()
    if relative.is_absolute() or not value or value.startswith("/"):
        raise ValidationError("artifactには相対パスだけを使用できます")
    if len(value) > MAX_ARCHIVE_PATH_LENGTH:
        raise ValidationError(f"artifact内パスが240文字を超えています: {value}")
    for part in relative.parts:
        if part in {"", ".", ".."}:
            raise ValidationError(f"安全でないartifact内パスです: {value}")
        if part.endswith((" ", ".")):
            raise ValidationError(f"末尾が空白またはピリオドのパスは使用できません: {value}")
        if part.split(".", 1)[0].upper() in WINDOWS_RESERVED_NAMES:
            raise ValidationError(f"Windows予約名は使用できません: {value}")
    return value


def _collect_build_files(build_directory: Path) -> list[tuple[Path, str]]:
    files: list[tuple[Path, str]] = []
    casefolded: dict[str, str] = {}
    for path in sorted(build_directory.rglob("*"), key=lambda item: item.as_posix().casefold()):
        if path.is_symlink() or _is_reparse_point(path):
            raise ValidationError(f"symlinkまたはreparse pointは使用できません: {path.name}")
        if not path.is_file():
            continue
        relative = Path("build") / path.relative_to(build_directory)
        archive_path = _validate_archive_path(relative)
        collision_key = archive_path.casefold()
        previous = casefolded.get(collision_key)
        if previous is not None:
            raise ValidationError(
                f"大文字小文字だけが異なるパスは同時に使用できません: {previous}, {archive_path}"
            )
        casefolded[collision_key] = archive_path
        if path.stat().st_size == 0:
            raise ValidationError(f"空ファイルはartifactに含められません: {archive_path}")
        files.append((path, archive_path))
    return files


def _sha256_file(path: Path, cancellation: CancellationToken) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            if cancellation.is_requested():
                raise ArtifactCancelled("artifact作成をキャンセルしました")
            digest.update(block)
    return digest.hexdigest()


class ArtifactService:
    def __init__(self, settings: IntakeSettings):
        self.settings = settings

    def create(self, draft: ReleaseDraft,
               progress: Callable[[int, str, str], None] | None = None,
               cancellation: CancellationToken | None = None) -> ArtifactResult:
        notify = progress or (lambda _percent, _stage, _detail: None)
        cancellation = cancellation or CancellationToken()
        validate_draft(draft)
        problems = self.settings.validate_output()
        if problems:
            raise ValidationError("\n".join(problems))
        artifact_id = str(uuid.uuid4())
        artifact_stem = f"{draft.game_id}-{draft.version}-{artifact_id}"
        final_archive = self.settings.output_root / f"{artifact_stem}.zip"
        descriptor_path = self.settings.output_root / f"{artifact_stem}.pandd-artifact.json"
        temporary_archive = self.settings.output_root / f".{artifact_id}.tmp"
        notify(2, "artifactを検証しています", "パス、容量、ファイル数を確認しています")
        try:
            build_files = _collect_build_files(draft.build_directory)
            if len(build_files) + 3 > MAX_ARTIFACT_FILES:
                raise ValidationError("metadataを含むartifactのファイル数は50,000件までです")
            source_bytes = sum(path.stat().st_size for path, _ in build_files)
            if source_bytes > MAX_ARTIFACT_BYTES:
                raise ValidationError("artifactの元データは5 GiB以下にしてください")
            with tempfile.TemporaryDirectory(dir=self.settings.output_root) as temporary:
                metadata_directory = Path(temporary) / "metadata"
                metadata = create_metadata(draft, metadata_directory)
                metadata_files = [metadata, *sorted(
                    path for path in metadata_directory.iterdir() if path != metadata
                )]
                entries = [*build_files, *(
                    (path, _validate_archive_path(Path("metadata") / path.name))
                    for path in metadata_files
                )]
                total_bytes = sum(path.stat().st_size for path, _ in entries)
                if total_bytes > MAX_ARTIFACT_BYTES:
                    raise ValidationError("metadataを含むartifactの合計容量は5 GiB以下にしてください")
                completed = 0
                with zipfile.ZipFile(
                    temporary_archive, "w", compression=zipfile.ZIP_DEFLATED,
                    compresslevel=6, allowZip64=True,
                ) as archive:
                    for source, archive_path in entries:
                        info = zipfile.ZipInfo(archive_path, date_time=(1980, 1, 1, 0, 0, 0))
                        info.compress_type = zipfile.ZIP_DEFLATED
                        info.external_attr = 0o100644 << 16
                        with source.open("rb") as input_file, \
                                archive.open(info, "w", force_zip64=True) as output_file:
                            for block in iter(lambda: input_file.read(1024 * 1024), b""):
                                if cancellation.is_requested():
                                    raise ArtifactCancelled("artifact作成をキャンセルしました")
                                output_file.write(block)
                                completed += len(block)
                                ratio = completed / total_bytes if total_bytes else 1
                                notify(5 + round(ratio * 80), "ZIP64 artifactを作成しています",
                                       f"{completed / (1024 ** 2):,.1f} / "
                                       f"{total_bytes / (1024 ** 2):,.1f} MiB  {archive_path}")
            size_bytes = temporary_archive.stat().st_size
            if size_bytes > MAX_ARTIFACT_BYTES:
                raise ValidationError("生成したartifactは5 GiB以下にしてください")
            notify(88, "SHA-256を計算しています", "artifact全体を再読み込みしています")
            artifact_sha256 = _sha256_file(temporary_archive, cancellation)
            temporary_archive.replace(final_archive)
            descriptor = {
                "schemaVersion": 1,
                "artifactId": artifact_id,
                "artifactFile": final_archive.name,
                "gameId": draft.game_id,
                "version": draft.version,
                "platform": "windows",
                "arch": "x86_64",
                "sizeBytes": size_bytes,
                "fileCount": len(entries),
                "sha256": artifact_sha256,
                "createdAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
                    .isoformat().replace("+00:00", "Z"),
            }
            validate_contract(descriptor, "deployment-artifact-descriptor.schema.json")
            descriptor_path.write_text(
                json.dumps(descriptor, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            notify(100, "artifactの準備が完了しました", descriptor_path.name)
            return ArtifactResult(
                artifact_id, final_archive, descriptor_path, artifact_sha256,
                size_bytes, len(entries),
            )
        except Exception:
            temporary_archive.unlink(missing_ok=True)
            final_archive.unlink(missing_ok=True)
            descriptor_path.unlink(missing_ok=True)
            raise
