#!/usr/bin/env python3
"""Build and atomically publish PandD's static launcher contracts."""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
from typing import Any, Callable, Iterable

from jsonschema import Draft202012Validator, FormatChecker

CHUNK_SIZE = 64 * 1024 * 1024
IMMUTABLE_CACHE = "public,max-age=31536000,immutable"
POINTER_CACHE = "public,max-age=60,must-revalidate"
SCHEMA_DIRECTORY = Path(__file__).resolve().parents[1] / "contracts" / "schemas"
REMOTE_LATEST_PATTERN = re.compile(
    r"^v1/games/[^/]+/releases/(?:windows|macos|linux)/(?:x86_64|arm64)/latest\.json$")
LOCALE_TAG_PATTERN = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")


class PublicationCancelled(RuntimeError):
    """Raised at a safe boundary when the current publication is cancelled."""


def _raise_if_cancelled(cancelled: Callable[[], bool] | None) -> None:
    if cancelled and cancelled():
        raise PublicationCancelled("公開処理をキャンセルしました")


def utc_now() -> str:
    """Return an RFC 3339 timestamp without local timezone ambiguity."""
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def canonical_json(value: Any) -> bytes:
    """Encode the exact canonical JSON form shared with the client verifier."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def write_json(path: Path, value: Any) -> None:
    """Write JSON through a sibling temporary file and atomic replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def sha256_bytes(value: bytes) -> str:
    """Return a lowercase SHA-256 digest."""
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    """Hash a publication object without loading large game chunks into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def publication_content_type(path: Path) -> str:
    """Return deterministic HTTP metadata instead of relying on AWS CLI host guesses."""
    explicit = {
        ".json": "application/json; charset=utf-8",
        ".xml": "application/xml; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
    }
    return explicit.get(path.suffix.lower(),
                        mimetypes.guess_type(path.name)[0] or "application/octet-stream")


def validate_contract(document: Any, schema_name: str) -> None:
    """Validate one source or public document against the checked-in contract."""
    schema = json.loads((SCHEMA_DIRECTORY / schema_name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(document)


def validate_relative_path(path: str) -> PurePosixPath:
    """Reject absolute, traversal, Windows separator, and unstable paths."""
    candidate = PurePosixPath(path)
    if not path or "\\" in path or candidate.is_absolute() or ".." in candidate.parts or "." in candidate.parts:
        raise ValueError(f"unsafe relative path: {path}")
    if str(candidate) != path or len(path) > 240:
        raise ValueError(f"non-canonical relative path: {path}")
    return candidate


def validate_working_directory(path: str) -> PurePosixPath:
    """Allow the build root while retaining all relative-path safety checks."""
    return PurePosixPath(".") if path == "." else validate_relative_path(path)


def validate_locale_tag(locale: str) -> str:
    """Reject unsafe or malformed BCP 47-style locale tags used in public paths."""
    if not LOCALE_TAG_PATTERN.fullmatch(locale):
        raise ValueError(f"invalid locale tag: {locale}")
    return locale


def find_openssl() -> str:
    """Resolve OpenSSL from an explicit environment variable or PATH."""
    executable = os.environ.get("OPENSSL_EXECUTABLE") or shutil.which("openssl")
    if not executable:
        raise RuntimeError("OpenSSL was not found; set OPENSSL_EXECUTABLE")
    return executable


def find_aws_cli() -> str | None:
    """Find AWS CLI on PATH or in its standard Windows installation directories."""
    executable = shutil.which("aws")
    if executable:
        return executable
    if os.name == "nt":
        candidates = [
            Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
            / "Amazon/AWSCLIV2/aws.exe",
            Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
            / "Amazon/AWSCLIV2/aws.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Amazon/AWSCLIV2/aws.exe",
        ]
        return next((str(path) for path in candidates if path.is_file()), None)
    return None


def sign_payload(payload: bytes, private_key: Path) -> str:
    """Sign canonical bytes using an external Ed25519 private key."""
    with tempfile.TemporaryDirectory(prefix="pandd-sign-") as temporary:
        payload_path = Path(temporary) / "payload.json"
        signature_path = Path(temporary) / "signature.bin"
        payload_path.write_bytes(payload)
        subprocess.run(
            [find_openssl(), "pkeyutl", "-sign", "-rawin", "-inkey", str(private_key),
             "-in", str(payload_path), "-out", str(signature_path)],
            check=True,
            capture_output=True,
        )
        signature = signature_path.read_bytes()
    if len(signature) != 64:
        raise RuntimeError("OpenSSL returned an invalid Ed25519 signature")
    return base64.b64encode(signature).decode("ascii")


def create_key(private_key: Path, public_key: Path) -> None:
    """Generate an Ed25519 keypair without writing private material to logs."""
    private_key.parent.mkdir(parents=True, exist_ok=True)
    public_key.parent.mkdir(parents=True, exist_ok=True)
    if private_key.exists() or public_key.exists():
        raise FileExistsError("refusing to overwrite an existing signing key")
    subprocess.run([find_openssl(), "genpkey", "-algorithm", "ED25519", "-out", str(private_key)],
                   check=True, capture_output=True)
    subprocess.run([find_openssl(), "pkey", "-in", str(private_key), "-pubout", "-out", str(public_key)],
                   check=True, capture_output=True)


def copy_asset(source: Path, output: Path, base_url: str) -> str:
    """Store a display asset under an immutable content-addressed URL."""
    content = source.read_bytes()
    digest = sha256_bytes(content)
    suffix = source.suffix.lower() or ".bin"
    relative = Path("v1/assets/sha256") / f"{digest}{suffix}"
    destination = output / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        destination.write_bytes(content)
    return f"{base_url.rstrip('/')}/{relative.as_posix()}"


def chunk_file(source: Path, output: Path, base_url: str,
               progress: Callable[[int], None] | None = None,
               cancelled: Callable[[], bool] | None = None,
               ) -> tuple[list[dict[str, Any]], int, str]:
    """Split one file into reusable content-addressed chunks."""
    chunks: list[dict[str, Any]] = []
    whole_hash = hashlib.sha256()
    offset = 0
    with source.open("rb") as stream:
        while block := stream.read(CHUNK_SIZE):
            _raise_if_cancelled(cancelled)
            whole_hash.update(block)
            digest = sha256_bytes(block)
            relative = Path("v1/blobs/sha256") / digest
            destination = output / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.exists():
                destination.write_bytes(block)
            chunks.append({
                "offset": offset,
                "size": len(block),
                "sha256": digest,
                "url": f"{base_url.rstrip('/')}/{relative.as_posix()}",
            })
            offset += len(block)
            if progress:
                progress(len(block))
    if offset == 0:
        raise ValueError(f"empty release files are not supported: {source}")
    return chunks, offset, whole_hash.hexdigest()


def build_game_release(metadata_path: Path, build_directory: Path, output: Path,
                       base_url: str, private_key: Path, platform: str, architecture: str,
                       progress: Callable[[int, int, str], None] | None = None,
                       cancelled: Callable[[], bool] | None = None) -> list[Path]:
    """Build blobs, immutable manifest, latest pointer, and localized catalogs."""
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    validate_contract(metadata, "game-release-source.schema.json")
    game_id = metadata["gameId"]
    version = metadata["version"]
    entrypoint = str(validate_relative_path(metadata["entrypoint"]))
    working_directory = str(validate_working_directory(metadata["workingDirectory"]))
    if metadata["engine"] not in {"unity", "godot", "siv3d"}:
        raise ValueError("unsupported engine")
    if platform not in {"windows", "macos", "linux"} or architecture not in {"x86_64", "arm64"}:
        raise ValueError("unsupported platform or architecture")

    sources = sorted(path for path in build_directory.rglob("*") if path.is_file())
    total_source_bytes = sum(path.stat().st_size for path in sources)
    processed_source_bytes = 0
    if progress:
        progress(0, total_source_bytes, "")
    files: list[dict[str, Any]] = []
    for source in sources:
        _raise_if_cancelled(cancelled)
        relative = source.relative_to(build_directory).as_posix()
        validate_relative_path(relative)

        def report_chunk(size: int, current: str = relative) -> None:
            nonlocal processed_source_bytes
            processed_source_bytes += size
            if progress:
                progress(processed_source_bytes, total_source_bytes, current)

        chunks, size, digest = chunk_file(source, output, base_url, report_chunk, cancelled)
        files.append({
            "path": relative,
            "size": size,
            "sha256": digest,
            "executable": relative == entrypoint or os.access(source, os.X_OK),
            "chunks": chunks,
        })
    if not files or entrypoint not in {item["path"] for item in files}:
        raise ValueError("entrypoint must exist inside the build directory")

    _raise_if_cancelled(cancelled)
    manifest: dict[str, Any] = {
        "schemaVersion": 1,
        "gameId": game_id,
        "version": version,
        "platform": platform,
        "arch": architecture,
        "minimumLauncherVersion": metadata["minimumLauncherVersion"],
        "engine": metadata["engine"],
        "entrypoint": entrypoint,
        "workingDirectory": working_directory,
        "arguments": [],
        "saveDirectoryName": metadata["saveDirectoryName"],
        "totalSize": sum(item["size"] for item in files),
        "files": files,
        "publishedAt": metadata["publishedAt"],
    }
    manifest["signature"] = sign_payload(canonical_json(manifest), private_key)
    validate_contract(manifest, "game-release.schema.json")
    immutable_relative = Path("v1/games") / game_id / "releases" / platform / architecture / version / "manifest.json"
    latest_relative = Path("v1/games") / game_id / "releases" / platform / architecture / "latest.json"
    immutable_path = output / immutable_relative
    if immutable_path.exists():
        existing = json.loads(immutable_path.read_text(encoding="utf-8"))
        if existing != manifest:
            raise RuntimeError("refusing to overwrite an immutable release manifest")
    else:
        write_json(immutable_path, manifest)

    _raise_if_cancelled(cancelled)
    hero_url = copy_asset(metadata_path.parent / metadata["hero"], output, base_url)
    thumbnail_url = copy_asset(metadata_path.parent / metadata["thumbnail"], output, base_url)
    focal_point = metadata["heroFocalPoint"]
    if (not isinstance(focal_point, dict)
            or not all(isinstance(focal_point.get(axis), (int, float))
                       and 0.0 <= focal_point[axis] <= 1.0 for axis in ("x", "y"))):
        raise ValueError("heroFocalPoint must contain x/y values between zero and one")
    for locale, display in metadata["display"].items():
        _raise_if_cancelled(cancelled)
        validate_locale_tag(locale)
        catalog_relative = Path("v1/catalog") / locale / platform / f"{architecture}.json"
        catalog_path = output / catalog_relative
        catalog = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.exists() else {
            "schemaVersion": 1, "generatedAt": utc_now(), "games": []}
        validate_contract(catalog, "catalog.schema.json")
        entry = {
            "gameId": game_id,
            "name": display["name"],
            "summary": display["summary"],
            "heroUrl": hero_url,
            "thumbnailUrl": thumbnail_url,
            "latestReleaseUrl": f"{base_url.rstrip('/')}/{latest_relative.as_posix()}",
            "heroFocalPoint": {"x": focal_point["x"], "y": focal_point["y"]},
        }
        catalog["games"] = [item for item in catalog["games"] if item["gameId"] != game_id] + [entry]
        catalog["games"].sort(key=lambda item: item["gameId"])
        catalog["generatedAt"] = utc_now()
        validate_contract(catalog, "catalog.schema.json")
        write_json(catalog_path, catalog)

    # latest is written only after every immutable object and catalog input is valid
    write_json(output / latest_relative, manifest)
    return [immutable_relative, latest_relative]


def publish_announcements(source_directory: Path, output: Path) -> None:
    """Normalize reviewed announcement source files into public endpoints."""
    for source in sorted(source_directory.glob("*.json")):
        validate_locale_tag(source.stem)
        document = json.loads(source.read_text(encoding="utf-8"))
        validate_contract(document, "announcements-source.schema.json")
        document["generatedAt"] = utc_now()
        validate_contract(document, "announcements.schema.json")
        write_json(output / "v1" / "announcements" / source.name, document)


def publish_launcher_release(source: Path, output: Path, base_url: str,
                             locale: str, platform: str, architecture: str) -> None:
    """Publish launcher release metadata from the same version used by Qt IFW."""
    validate_locale_tag(locale)
    document = json.loads(source.read_text(encoding="utf-8"))
    validate_contract(document, "launcher-release-source.schema.json")
    public = {
        "schemaVersion": 1,
        "version": document["version"],
        "mandatory": bool(document["mandatory"]),
        "title": document["title"],
        "publishedAt": document["publishedAt"],
        "ifwRepositoryUrl": (
            f"{base_url.rstrip('/')}/v1/launcher/ifw/{platform}/{architecture}"
        ),
    }
    validate_contract(public, "launcher-release.schema.json")
    relative = Path("v1/launcher/releases") / locale / platform / architecture / "latest.json"
    write_json(output / relative, public)


def publish_launcher_changelog(source: Path, output: Path, locale: str) -> None:
    """Publish the reviewed localized history through its single dedicated source."""
    validate_locale_tag(locale)
    document = json.loads(source.read_text(encoding="utf-8"))
    validate_contract(document, "launcher-changelog.schema.json")
    write_json(output / "v1" / "launcher" / "changelog" / f"{locale}.json", document)


def clean_unreferenced_blobs(output: Path, grace_days: int, dry_run: bool) -> list[Path]:
    """Remove releases and blobs outside the current/previous retention window."""
    referenced: set[str] = set()
    cutoff = dt.datetime.now(dt.timezone.utc).timestamp() - grace_days * 86400
    removed: list[Path] = []
    latest_files = list(output.glob("v1/games/*/releases/*/*/latest.json"))
    for latest in latest_files:
        release_root = latest.parent
        latest_document = json.loads(latest.read_text(encoding="utf-8"))
        current_version = tuple(int(part) for part in latest_document["version"].split("."))
        version_manifests = list(release_root.glob("*/manifest.json"))
        version_manifests.sort(
            key=lambda path: tuple(int(part) for part in path.parent.name.split(".")),
            reverse=True,
        )
        current_manifest = next(
            (path for path in version_manifests if path.parent.name == latest_document["version"]),
            None,
        )
        previous_manifest = next(
            (path for path in version_manifests
             if tuple(int(part) for part in path.parent.name.split(".")) < current_version),
            None,
        )
        retained_manifests = [path for path in (current_manifest, previous_manifest) if path]
        manifests = [latest, *retained_manifests]
        for manifest_path in manifests:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for file in manifest.get("files", []):
                referenced.update(chunk["sha256"] for chunk in file.get("chunks", []))

        # latest昇格から猶予期間を過ぎたreleaseだけを削除対象にする
        retained = {path.parent for path in retained_manifests}
        for manifest_path in version_manifests:
            release_directory = manifest_path.parent
            if release_directory not in retained and manifest_path.stat().st_mtime <= cutoff:
                removed.append(release_directory)
                if not dry_run:
                    shutil.rmtree(release_directory)

    blob_root = output / "v1" / "blobs" / "sha256"
    for blob in blob_root.glob("*") if blob_root.exists() else []:
        if blob.name not in referenced and blob.stat().st_mtime <= cutoff:
            removed.append(blob)
            if not dry_run:
                blob.unlink()
    return removed


def semantic_version(value: str) -> tuple[int, int, int]:
    """Parse the exact three-component version used by all publication contracts."""
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", value):
        raise ValueError(f"invalid semantic version: {value}")
    return tuple(int(part) for part in value.split("."))


def remote_gc(endpoint: str, bucket: str, grace_days: int, dry_run: bool) -> list[str]:
    """Delete only aged remote releases/blobs outside every current/previous set."""
    aws = find_aws_cli()
    if not aws:
        raise RuntimeError("AWS CLI was not found; install it only on the publisher runner")
    listing = subprocess.run(
        [aws, "s3api", "list-objects-v2", "--bucket", bucket, "--prefix", "v1/",
         "--endpoint-url", endpoint, "--output", "json"],
        check=True, capture_output=True, text=True,
    )
    objects = {item["Key"]: item for item in json.loads(listing.stdout).get("Contents", [])}
    latest_keys = sorted(key for key in objects if REMOTE_LATEST_PATTERN.fullmatch(key))
    blob_keys = {key for key in objects if key.startswith("v1/blobs/sha256/")}
    if not latest_keys:
        if blob_keys:
            raise RuntimeError("remote blobs exist without a latest manifest; refusing cleanup")
        return []

    def read_json(key: str) -> dict[str, Any]:
        """Read one public object without creating credential-bearing temporary files."""
        result = subprocess.run(
            [aws, "s3", "cp", f"s3://{bucket}/{key}", "-", "--endpoint-url", endpoint,
             "--no-progress"],
            check=True, capture_output=True, text=True,
        )
        return json.loads(result.stdout)

    retained_manifests: set[str] = set()
    referenced_blobs: set[str] = set()
    release_roots: set[str] = set()
    for latest_key in latest_keys:
        release_root = latest_key.removesuffix("/latest.json")
        release_roots.add(release_root)
        current_document = read_json(latest_key)
        current_version = semantic_version(current_document["version"])
        manifests: list[tuple[tuple[int, int, int], str]] = []
        prefix = release_root + "/"
        for key in objects:
            if key.startswith(prefix) and key.endswith("/manifest.json"):
                version_text = key[len(prefix):].removesuffix("/manifest.json")
                if "/" not in version_text:
                    manifests.append((semantic_version(version_text), key))
        current = next((key for version, key in manifests if version == current_version), None)
        if current is None:
            raise RuntimeError(f"latest references a missing immutable manifest: {latest_key}")
        previous = next((key for version, key in sorted(manifests, reverse=True)
                         if version < current_version), None)
        retained_manifests.add(current)
        if previous:
            retained_manifests.add(previous)

    for key in retained_manifests:
        manifest = read_json(key)
        for file in manifest.get("files", []):
            for chunk in file.get("chunks", []):
                digest = chunk.get("sha256")
                if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                    raise RuntimeError(f"retained manifest contains an invalid chunk hash: {key}")
                referenced_blobs.add(f"v1/blobs/sha256/{digest}")

    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=grace_days)

    def is_aged(key: str) -> bool:
        """Compare server inventory timestamps as timezone-aware UTC instants."""
        value = objects[key].get("LastModified")
        if not isinstance(value, str):
            raise RuntimeError(f"remote inventory is missing LastModified: {key}")
        modified = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return modified <= cutoff

    candidates: set[str] = set()
    for root in release_roots:
        for key in objects:
            if (key.startswith(root + "/") and key.endswith("/manifest.json")
                    and key not in retained_manifests and is_aged(key)):
                candidates.add(key)
    candidates.update(key for key in blob_keys
                      if key not in referenced_blobs and is_aged(key))

    # Remove obsolete release records before their now-unreferenced content chunks.
    removed = sorted(candidates, key=lambda key: (key.startswith("v1/blobs/"), key))
    if not dry_run:
        for key in removed:
            subprocess.run(
                [aws, "s3api", "delete-object", "--bucket", bucket, "--key", key,
                 "--endpoint-url", endpoint],
                check=True,
            )
    return removed


def upload_tree(output: Path, endpoint: str, bucket: str,
                progress: Callable[[int, int, str], None] | None = None,
                cancelled: Callable[[], bool] | None = None,
                before_pointer_promotion: Callable[[], None] | None = None,
                phase: str = "all") -> None:
    """Upload immutable objects first, verify them, then promote mutable pointers."""
    if phase not in {"all", "immutable", "pointers"}:
        raise ValueError("upload phase must be all, immutable, or pointers")
    aws = find_aws_cli()
    if not aws:
        raise RuntimeError("AWS CLI was not found; install it only on the publisher runner")
    files = sorted(path for path in output.rglob("*") if path.is_file())
    pointers = [path for path in files
                if path.name in {"latest.json", "Updates.xml"}
                or "catalog" in path.parts
                or "announcements" in path.parts
                or "changelog" in path.parts]
    # latest pointer is promoted only after every artifact and supporting index is visible
    pointers.sort(key=lambda path: (path.name == "latest.json", path.as_posix()))
    immutable = [path for path in files if path not in pointers]
    total_bytes = sum(path.stat().st_size for path in files)
    completed_bytes = 0
    if progress:
        progress(0, total_bytes, "")

    def remote_metadata(relative: str) -> dict[str, Any] | None:
        """Read remote integrity metadata, returning None only for a missing object."""
        head = subprocess.run(
            [aws, "s3api", "head-object", "--bucket", bucket, "--key", relative,
             "--endpoint-url", endpoint,
             "--query", "{size:ContentLength,sha256:Metadata.sha256,contentType:ContentType}",
             "--output", "json"],
            check=False, capture_output=True, text=True,
        )
        if head.returncode != 0:
            return None
        return json.loads(head.stdout)

    def publish(path: Path, immutable_object: bool) -> None:
        nonlocal completed_bytes
        relative = path.relative_to(output).as_posix()
        cache = IMMUTABLE_CACHE if immutable_object else POINTER_CACHE
        digest = sha256_file(path)
        content_type = publication_content_type(path)
        expected = {"size": path.stat().st_size, "sha256": digest, "contentType": content_type}
        if immutable_object:
            existing = remote_metadata(relative)
            if existing is not None:
                if existing != expected:
                    raise RuntimeError(f"refusing to overwrite immutable object: {relative}")
                completed_bytes += path.stat().st_size
                if progress:
                    progress(completed_bytes, total_bytes, relative)
                return
        subprocess.run([aws, "s3", "cp", str(path), f"s3://{bucket}/{relative}",
                        "--endpoint-url", endpoint, "--cache-control", cache,
                        "--content-type", content_type, "--metadata", f"sha256={digest}"],
                       check=True)
        remote = remote_metadata(relative)
        if remote != expected:
            raise RuntimeError(f"uploaded object metadata mismatch: {relative}")
        completed_bytes += path.stat().st_size
        if progress:
            progress(completed_bytes, total_bytes, relative)

    if phase in {"all", "immutable"}:
        for path in immutable:
            _raise_if_cancelled(cancelled)
            publish(path, True)

    if phase == "immutable":
        return

    if phase == "pointers":
        for path in immutable:
            relative = path.relative_to(output).as_posix()
            expected = {
                "size": path.stat().st_size,
                "sha256": sha256_file(path),
                "contentType": publication_content_type(path),
            }
            if remote_metadata(relative) != expected:
                raise RuntimeError(f"immutable object is missing or mismatched: {relative}")

    # From this point all mutable pointers are promoted as one non-cancellable commit.
    _raise_if_cancelled(cancelled)
    if before_pointer_promotion:
        before_pointer_promotion()
    for path in pointers:
        publish(path, False)


def parse_arguments() -> argparse.Namespace:
    """Parse the intentionally small Publisher command surface."""
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    key = subcommands.add_parser("init-key")
    key.add_argument("--private-key", type=Path, required=True)
    key.add_argument("--public-key", type=Path, required=True)
    game = subcommands.add_parser("publish-game")
    game.add_argument("--metadata", type=Path, required=True)
    game.add_argument("--build-dir", type=Path, required=True)
    game.add_argument("--output", type=Path, required=True)
    game.add_argument("--base-url", required=True)
    game.add_argument("--private-key", type=Path, required=True)
    game.add_argument("--platform", choices=["windows", "macos", "linux"], required=True)
    game.add_argument("--arch", choices=["x86_64", "arm64"], required=True)
    game.add_argument("--endpoint")
    game.add_argument("--bucket")
    announcements = subcommands.add_parser("publish-announcements")
    announcements.add_argument("--source", type=Path, required=True)
    announcements.add_argument("--output", type=Path, required=True)
    launcher = subcommands.add_parser("publish-launcher")
    launcher.add_argument("--source", type=Path, required=True)
    launcher.add_argument("--output", type=Path, required=True)
    launcher.add_argument("--base-url", required=True)
    launcher.add_argument("--locale", required=True)
    launcher.add_argument("--platform", choices=["windows", "macos", "linux"], required=True)
    launcher.add_argument("--arch", choices=["x86_64", "arm64"], required=True)
    changelog = subcommands.add_parser("publish-changelog")
    changelog.add_argument("--source", type=Path, required=True)
    changelog.add_argument("--output", type=Path, required=True)
    changelog.add_argument("--locale", required=True)
    cleanup = subcommands.add_parser("gc-local")
    cleanup.add_argument("--output", type=Path, required=True)
    cleanup.add_argument("--grace-days", type=int, default=7)
    cleanup.add_argument("--dry-run", action="store_true")
    remote_cleanup = subcommands.add_parser("gc-remote")
    remote_cleanup.add_argument("--endpoint", required=True)
    remote_cleanup.add_argument("--bucket", required=True)
    remote_cleanup.add_argument("--grace-days", type=int, default=7)
    remote_cleanup.add_argument("--dry-run", action="store_true")
    upload = subcommands.add_parser("upload")
    upload.add_argument("--output", type=Path, required=True)
    upload.add_argument("--endpoint", required=True)
    upload.add_argument("--bucket", required=True)
    upload_immutable = subcommands.add_parser("upload-immutable")
    upload_immutable.add_argument("--output", type=Path, required=True)
    upload_immutable.add_argument("--endpoint", required=True)
    upload_immutable.add_argument("--bucket", required=True)
    promote_pointers = subcommands.add_parser("promote-pointers")
    promote_pointers.add_argument("--output", type=Path, required=True)
    promote_pointers.add_argument("--endpoint", required=True)
    promote_pointers.add_argument("--bucket", required=True)
    return parser.parse_args()


def main() -> int:
    """Execute one Publisher operation and fail before pointer promotion on error."""
    arguments = parse_arguments()
    if arguments.command == "init-key":
        create_key(arguments.private_key, arguments.public_key)
    elif arguments.command == "publish-game":
        if bool(arguments.endpoint) != bool(arguments.bucket):
            raise ValueError("--endpoint and --bucket must be supplied together")
        build_game_release(arguments.metadata, arguments.build_dir, arguments.output,
                           arguments.base_url, arguments.private_key, arguments.platform,
                           arguments.arch)
        if arguments.endpoint:
            upload_tree(arguments.output, arguments.endpoint, arguments.bucket)
    elif arguments.command == "publish-announcements":
        publish_announcements(arguments.source, arguments.output)
    elif arguments.command == "publish-launcher":
        publish_launcher_release(arguments.source, arguments.output, arguments.base_url,
                                 arguments.locale, arguments.platform, arguments.arch)
    elif arguments.command == "publish-changelog":
        publish_launcher_changelog(arguments.source, arguments.output, arguments.locale)
    elif arguments.command == "gc-local":
        if arguments.grace_days < 7:
            raise ValueError("cleanup grace period must be at least seven days")
        for removed in clean_unreferenced_blobs(arguments.output, arguments.grace_days,
                                                arguments.dry_run):
            print(removed)
    elif arguments.command == "gc-remote":
        if arguments.grace_days < 7:
            raise ValueError("cleanup grace period must be at least seven days")
        for removed in remote_gc(arguments.endpoint, arguments.bucket, arguments.grace_days,
                                 arguments.dry_run):
            print(removed)
    elif arguments.command == "upload":
        upload_tree(arguments.output, arguments.endpoint, arguments.bucket)
    elif arguments.command == "upload-immutable":
        upload_tree(arguments.output, arguments.endpoint, arguments.bucket, phase="immutable")
    elif arguments.command == "promote-pointers":
        upload_tree(arguments.output, arguments.endpoint, arguments.bucket, phase="pointers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
