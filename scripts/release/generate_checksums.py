#!/usr/bin/env python3
"""Create or verify conventional SHA-256 sidecar files for release artifacts."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


def sha256_file(path: Path) -> str:
    """Hash an artifact without loading it into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def write_checksum(artifact: Path) -> Path:
    """Write `<digest>  <filename>` beside one artifact."""
    if not artifact.is_file():
        raise FileNotFoundError(artifact)
    sidecar = artifact.with_name(f"{artifact.name}.sha256")
    sidecar.write_text(f"{sha256_file(artifact)}  {artifact.name}\n", encoding="ascii")
    return sidecar


def verify_checksum(sidecar: Path) -> None:
    """Verify one strict single-artifact checksum file."""
    fields = sidecar.read_text(encoding="ascii").rstrip("\n").split("  ")
    if len(fields) != 2 or len(fields[0]) != 64 or Path(fields[1]).name != fields[1]:
        raise ValueError(f"invalid SHA-256 sidecar: {sidecar}")
    artifact = sidecar.parent / fields[1]
    if not artifact.is_file() or sha256_file(artifact) != fields[0]:
        raise ValueError(f"SHA-256 verification failed: {artifact}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("paths", nargs="+", type=Path)
    arguments = parser.parse_args()
    if arguments.check:
        for path in arguments.paths:
            verify_checksum(path)
    else:
        for path in arguments.paths:
            write_checksum(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
