"""Validate and safely extract an immutable intake artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import zipfile

from services.deployment_publisher.publisher import validate_contract, validate_relative_path


MAX_BYTES = 5 * 1024 * 1024 * 1024
MAX_FILES = 50_000
WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}


def validate_member(info: zipfile.ZipInfo, seen: set[str]) -> PurePosixPath:
    validate_relative_path(info.filename)
    path = PurePosixPath(info.filename)
    if info.is_dir() or path.is_absolute() or not path.parts or ".." in path.parts:
        raise ValueError(f"unsafe artifact path: {info.filename}")
    if len(info.filename) > 240 or path.parts[0] not in {"build", "metadata"}:
        raise ValueError(f"unsupported artifact path: {info.filename}")
    for part in path.parts:
        if part.endswith((" ", ".")) or any(character in part for character in '<>:"|?*') or \
                any(ord(character) < 32 for character in part) or \
                part.split(".", 1)[0].upper() in WINDOWS_RESERVED_NAMES:
            raise ValueError(f"Windows-unsafe artifact path: {info.filename}")
    mode = info.external_attr >> 16
    if stat.S_ISLNK(mode):
        raise ValueError(f"artifact symlink is not allowed: {info.filename}")
    folded = info.filename.casefold()
    if folded in seen:
        raise ValueError(f"duplicate artifact path: {info.filename}")
    seen.add(folded)
    if info.file_size <= 0:
        raise ValueError(f"empty artifact file is not allowed: {info.filename}")
    return path


def validate_and_extract(archive: Path, snapshot_path: Path, output: Path) -> None:
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    artifact = snapshot["artifact"]
    if archive.stat().st_size != artifact["sizeBytes"]:
        raise ValueError("artifact size mismatch")
    digest = hashlib.sha256()
    with archive.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != artifact["sha256"]:
        raise ValueError("artifact SHA-256 mismatch")
    if output.exists():
        raise ValueError("extraction output already exists")
    output.mkdir(parents=True)
    try:
        with zipfile.ZipFile(archive) as bundle:
            members = [info for info in bundle.infolist() if not info.is_dir()]
            if len(members) != artifact["fileCount"] or len(members) > MAX_FILES:
                raise ValueError("artifact file count mismatch")
            if sum(info.file_size for info in members) > MAX_BYTES:
                raise ValueError("artifact expanded size exceeds 5 GiB")
            seen: set[str] = set()
            for info in members:
                relative = validate_member(info, seen)
                destination = output.joinpath(*relative.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(info) as source, destination.open("xb") as target:
                    shutil.copyfileobj(source, target, 1024 * 1024)
        metadata_path = output / "metadata" / "release.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        validate_contract(metadata, "game-release-source.schema.json")
        expected = snapshot["metadata"]
        if metadata.get("gameId") != expected["gameId"] or metadata.get("version") != expected["version"]:
            raise ValueError("release metadata does not match immutable request")
        if not any(path.is_file() for path in (output / "build").rglob("*")):
            raise ValueError("artifact build is empty")
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    validate_and_extract(arguments.archive, arguments.snapshot, arguments.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
