#!/usr/bin/env python3
"""Download canonical license texts and verify their pinned release hashes."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import urllib.request


LICENSE_SOURCES = {
    "LGPL-3.0-only.txt": (
        "https://www.gnu.org/licenses/lgpl-3.0.txt",
        "e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118",
    ),
    "GPL-3.0-only.txt": (
        "https://www.gnu.org/licenses/gpl-3.0.txt",
        "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986",
    ),
    "Apache-2.0.txt": (
        "https://www.apache.org/licenses/LICENSE-2.0.txt",
        "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    ),
    "Qt-GPL-exception-1.0.txt": (
        "https://raw.githubusercontent.com/qtproject/installer-framework/4.11.0/"
        "LICENSES/Qt-GPL-exception-1.0.txt",
        "8d54a7a204e225c5cc7db07236f3bef4d9d4605fb5c90d2ffc92f6cbef93527e",
    ),
}


def fetch_verified(url: str, expected_sha256: str) -> bytes:
    """Fetch one bounded public text and reject any upstream byte change."""
    request = urllib.request.Request(url, headers={"User-Agent": "PandD-License-Collector/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read(128 * 1024 + 1)
    if len(content) > 128 * 1024:
        raise ValueError(f"license response is unexpectedly large: {url}")
    if hashlib.sha256(content).hexdigest() != expected_sha256:
        raise ValueError(f"license hash changed; review before updating the pin: {url}")
    return content


def collect(output: Path) -> None:
    """Write all verified texts atomically into a clean release license directory."""
    output.mkdir(parents=True, exist_ok=True)
    expected_names = set(LICENSE_SOURCES)
    unexpected = {path.name for path in output.iterdir() if path.is_file()} - expected_names
    if unexpected:
        raise ValueError(f"unexpected existing license files: {sorted(unexpected)}")
    for name, (url, digest) in LICENSE_SOURCES.items():
        content = fetch_verified(url, digest)
        destination = output / name
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_bytes(content)
        temporary.replace(destination)


def main() -> int:
    """Collect the exact license payload used by CI release artifacts."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    collect(arguments.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
