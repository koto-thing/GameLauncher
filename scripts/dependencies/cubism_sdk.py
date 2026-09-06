"""Pinned Live2D Cubism SDK download and validation helpers."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zipfile


OFFICIAL_CUBISM_VERSION = "5-r.5"
OFFICIAL_CUBISM_ARCHIVE_NAME = "CubismSdkForNative-5-r.5.zip"
OFFICIAL_CUBISM_DIRECTORY_NAME = "CubismSdkForNative-5-r.5"
OFFICIAL_CUBISM_ARCHIVE_URL = (
    "https://cubism.live2d.com/sdk-native/bin/CubismSdkForNative-5-r.5.zip"
)
OFFICIAL_CUBISM_ARCHIVE_SHA256 = (
    "7ff3a4bbc19c0a8728965aa522ab77eb11b252916453e68a8a78d3b71188bb12"
)
OFFICIAL_CUBISM_ARCHIVE_SIZE = 27_566_034

LICENSE_CONSENT_ENV = "PANDD_CUBISM_LICENSE_ACCEPTED"
CONSENT_VALUE = "accept"

NETWORK_TIMEOUT_SECONDS = 120
DOWNLOAD_USER_AGENT = "PandD-GameLauncher/1.0 (+https://github.com/koto-thing/GameLauncher)"
MAX_ARCHIVE_BYTES = OFFICIAL_CUBISM_ARCHIVE_SIZE
MAX_EXTRACTED_BYTES = 256 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 10_000

WINDOWS_DEVICE_NAMES = frozenset({"CON", "PRN", "AUX", "NUL", "CLOCK$"})
WINDOWS_DEVICE_SUFFIXES = frozenset("123456789¹²³")

ALLOWED_ARCHIVE_HOSTS = frozenset({"cubism.live2d.com"})
REQUIRED_CORE_RELATIVE_PATHS = (
    Path("Core/lib/windows/x86_64/143/Live2DCubismCore_MD.lib"),
    Path("Core/lib/windows/x86_64/143/Live2DCubismCore_MDd.lib"),
    Path("Core/lib/macos/arm64/libLive2DCubismCore.a"),
    Path("Core/lib/macos/x86_64/libLive2DCubismCore.a"),
    Path("Core/lib/linux/x86_64/libLive2DCubismCore.a"),
)

def _validate_https_url(url: str, allowed_hosts: frozenset[str]) -> None:
    if any(ord(character) <= 32 or ord(character) == 127 for character in url) or "\\" in url:
        raise ValueError(f"unsafe download URL: {url!r}")
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"only HTTPS URLs are allowed: {url}")
    if (parsed.username is not None or parsed.password is not None
            or parsed.params or parsed.query or parsed.fragment
            or parsed.port not in (None, 443)):
        raise ValueError(f"unexpected URL components are not allowed: {url}")
    if parsed.hostname not in allowed_hosts:
        raise ValueError(f"unexpected download host: {parsed.hostname}")


class _OfficialRedirectHandler(HTTPRedirectHandler):
    """Validate every redirect before urllib can contact its destination."""

    def __init__(self, allowed_hosts: frozenset[str]) -> None:
        super().__init__()
        self.allowed_hosts = allowed_hosts

    def redirect_request(self, request, response, code, message, headers, new_url):
        _validate_https_url(new_url, self.allowed_hosts)
        return super().redirect_request(request, response, code, message, headers, new_url)


def require_explicit_license_acceptance(environment: dict[str, str] | None = None) -> None:
    """Reject unattended downloads unless CI explicitly records license acceptance."""
    variables = os.environ if environment is None else environment
    if variables.get(LICENSE_CONSENT_ENV) != CONSENT_VALUE:
        raise RuntimeError(
            "Official Cubism SDK download requires explicit license consent. "
            f"Set {LICENSE_CONSENT_ENV}={CONSENT_VALUE} before running the downloader."
        )


def _download_with_sha256(url: str, destination: Path, expected_sha256: str,
                          allowed_hosts: frozenset[str], max_bytes: int) -> None:
    _validate_https_url(url, allowed_hosts)
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    total = 0
    opener = build_opener(_OfficialRedirectHandler(allowed_hosts))
    with tempfile.TemporaryDirectory(prefix="download-", dir=destination.parent) as temporary:
        pending = Path(temporary) / "payload"
        request = Request(url, headers={
            "Accept": "application/octet-stream",
            "User-Agent": DOWNLOAD_USER_AGENT,
        })
        with opener.open(request, timeout=NETWORK_TIMEOUT_SECONDS) as response, pending.open("wb") as handle:
            _validate_https_url(response.geturl(), allowed_hosts)
            while True:
                chunk = response.read(min(1024 * 1024, max_bytes - total + 1))
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError(f"download exceeded the configured size limit: {url}")
                digest.update(chunk)
                handle.write(chunk)
        if digest.hexdigest() != expected_sha256:
            raise ValueError(f"download hash mismatch for {url}")
        pending.replace(destination)


def download_official_cubism_archive(destination: Path) -> Path:
    """Download the reviewed official Cubism archive after explicit consent."""
    require_explicit_license_acceptance()
    _download_with_sha256(
        OFFICIAL_CUBISM_ARCHIVE_URL,
        destination,
        OFFICIAL_CUBISM_ARCHIVE_SHA256,
        ALLOWED_ARCHIVE_HOSTS,
        MAX_ARCHIVE_BYTES,
    )
    size = destination.stat().st_size
    if size != OFFICIAL_CUBISM_ARCHIVE_SIZE:
        raise ValueError(
            "downloaded Cubism archive size changed; review the new official payload "
            f"before updating the pin: {size}"
        )
    return destination


def validate_extracted_sdk_layout(sdk_root: Path) -> None:
    """Ensure the reviewed archive still contains the expected cross-platform SDK payload."""
    required_files = [
        sdk_root / "cubism-info.yml",
        sdk_root / "Core" / "include" / "Live2DCubismCore.h",
    ]
    required_files.extend(sdk_root / relative_path for relative_path in REQUIRED_CORE_RELATIVE_PATHS)
    required_directories = [
        sdk_root / "Framework" / "src",
        sdk_root / "Framework" / "src" / "Rendering" / "OpenGL" / "Shaders" / "Standard",
    ]
    missing = [str(path) for path in required_files if not path.is_file()]
    missing.extend(str(path) for path in required_directories if not path.is_dir())
    if missing:
        raise ValueError(
            "official Cubism SDK archive is missing required reviewed files: "
            + ", ".join(missing)
        )


def _is_windows_reserved_part(part: str) -> bool:
    """Reject names Windows cannot safely create, independent of the host Python version."""
    if part.endswith((" ", ".")) or any(ord(character) < 32 for character in part):
        return True
    if any(character in '"*?<>|' for character in part):
        return True
    stem = part.split(".", 1)[0].upper()
    return (
        stem in WINDOWS_DEVICE_NAMES
        or (
            len(stem) == 4
            and stem[:3] in {"COM", "LPT"}
            and stem[3] in WINDOWS_DEVICE_SUFFIXES
        )
    )


def _validated_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = archive.infolist()
    if not members or len(members) > MAX_ARCHIVE_MEMBERS:
        raise ValueError("archive contents are unexpectedly large")
    total_uncompressed = 0
    top_level_directories: set[str] = set()
    seen: set[str] = set()
    for member in members:
        path = PurePosixPath(member.filename)
        parts = member.filename.removesuffix("/").split("/")
        if (member.orig_filename != member.filename
                or "\\" in member.filename or ":" in member.filename
                or any(
                    part in ("", ".", "..") or _is_windows_reserved_part(part)
                    for part in parts
                )
                or (not member.is_dir() and len(parts) < 2)):
            raise ValueError(f"unsafe archive entry: {member.filename}")
        key = "/".join(parts).casefold()
        if key in seen:
            raise ValueError(f"duplicate archive entry: {member.filename}")
        seen.add(key)
        mode = member.external_attr >> 16
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ValueError(f"non-regular entries are not allowed: {member.filename}")
        total_uncompressed += member.file_size
        if total_uncompressed > MAX_EXTRACTED_BYTES:
            raise ValueError("archive contents exceed the configured extraction limit")
        top_level_directories.add(path.parts[0])
    if top_level_directories != {OFFICIAL_CUBISM_DIRECTORY_NAME}:
        raise ValueError(
            "archive root changed; review the new official payload before extracting it"
        )
    return members


def extract_cubism_archive(archive_path: Path, destination: Path) -> Path:
    """Safely extract the reviewed Cubism SDK into an empty destination directory."""
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(f"destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        members = _validated_members(archive)
        with tempfile.TemporaryDirectory(prefix="cubism-sdk-", dir=destination.parent) as temporary:
            staging_root = Path(temporary) / "extract"
            staging_root.mkdir(parents=True, exist_ok=True)
            for member in members:
                path = PurePosixPath(member.filename)
                relative = Path(*path.parts[1:])
                target = staging_root / relative
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(member) as source, target.open("xb") as handle:
                        shutil.copyfileobj(source, handle)
            validate_extracted_sdk_layout(staging_root)
            staging_root.rename(destination)
    return destination
