#!/usr/bin/env python3
"""Collect reviewed release license texts without distributing SDK sources."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

SOURCE_DIRECTORY = Path(__file__).resolve().parents[2] / "licenses"
LICENSE_SOURCES = {
    "ThreeJS-LICENSE.txt":
        "bfe119ea4fd413f5f7ca3fcd63adb0c4a073ed39daa2fe7d3e6b769e21272601",
    "ThreeVRM-LICENSE.txt":
        "387a46128d34de9d85ea1e07a5a716dba532dbabca6c10adad447f48a29518d3",
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
    # 同梱フォント M PLUS 2 と Saira の google/fonts 配布版 OFL.txt
    "MPLUS2-OFL.txt":
        "04971e3fcee60b247395150d93b3616f6a0b092572332c96187b472976553abc",
    # Windows の PandD Setup が同梱する Press Start 2P の OFL.txt
    "PressStart2P-OFL.txt":
        "004fc993a3bdaaf0fd443cb58d7e5c2fd09fc3a93b23309d0005421f7b8b7123",
    # Windows の PandD Setup が同梱する DotGothic16 の OFL.txt
    "DotGothic16-OFL.txt":
        "b6630c61ea078cacd7fabe37d14ffe557a0b45b06683374a9aa9e24262993e33",
    "Saira-OFL.txt":
        "f2665d4718b452b3818a877191355ac884a6b9b419d35408fe7ee487e9e8f30f",
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
