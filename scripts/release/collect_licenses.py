#!/usr/bin/env python3
"""Collect reviewed release license texts without distributing SDK sources."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

SOURCE_DIRECTORY = Path(__file__).resolve().parents[2] / "licenses"
LICENSE_SOURCES = {
    "LGPL-3.0-only.txt":
        "e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118",
    "GPL-3.0-only.txt":
        "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986",
    "Apache-2.0.txt":
        "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    "Qt-IFW-GPL3-Exception.txt":
        "0dbe024961f6ab5c52689cbd036c977975d0d0f6a67ff97762d96cb819dd5652",
    # Exact vcpkg GLEW 2.3.1 share/glew/copyright, including Mesa and Khronos notices.
    "GLEW-LICENSE.txt":
        "8991cd11befec7c6a63662700f03c0cc42e864b6e77c7e70b80297c951a7f0ff",
    "Live2D-Proprietary-Software-License-Agreement.html":
        "e7b4ffc6c636de2cfdd6d2eed6a4e43fa7034e7f15a0c3a15f1603dbb3b4c2b6",
    "Live2D-Open-Software-License-Agreement.html":
        "a8274bf5f461335738791e9f392eb3f3684eaa22cbb4dfe1f3f887c3586a8d82",
}


def read_verified(source: Path, expected_sha256: str) -> bytes:
    """Read one bounded vendored text and reject any byte change."""
    with source.open("rb") as handle:
        content = handle.read(128 * 1024 + 1)
    if len(content) > 128 * 1024:
        raise ValueError(f"license source is unexpectedly large: {source}")
    if hashlib.sha256(content).hexdigest() != expected_sha256:
        raise ValueError(f"license hash changed; review before updating the pin: {source}")
    return content


def write_atomic(destination: Path, content: bytes) -> None:
    """Write one license file atomically after validation."""
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_bytes(content)
    temporary.replace(destination)


def collect(output: Path) -> None:
    """Write all verified vendored licenses without network access."""
    output.mkdir(parents=True, exist_ok=True)
    expected_names = set(LICENSE_SOURCES)
    unexpected = {path.name for path in output.iterdir()} - expected_names
    if unexpected:
        raise ValueError(f"unexpected existing license files: {sorted(unexpected)}")
    for name, digest in LICENSE_SOURCES.items():
        content = read_verified(SOURCE_DIRECTORY / name, digest)
        write_atomic(output / name, content)


def main() -> int:
    """Collect the exact license payload used by CI release artifacts."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    collect(arguments.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
