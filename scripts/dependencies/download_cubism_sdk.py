#!/usr/bin/env python3
"""Download and safely extract the pinned official Cubism SDK for Native."""

from __future__ import annotations

import argparse
from pathlib import Path
import tempfile

from scripts.dependencies import cubism_sdk


def main() -> int:
    """Download the reviewed SDK archive and extract it into the requested root."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    arguments = parser.parse_args()

    destination = arguments.destination.resolve()
    if destination.name != cubism_sdk.OFFICIAL_CUBISM_DIRECTORY_NAME:
        raise ValueError(
            "destination must end with the pinned SDK directory name "
            f"{cubism_sdk.OFFICIAL_CUBISM_DIRECTORY_NAME}"
        )
    if destination.exists():
        raise FileExistsError(f"destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="cubism-archive-", dir=destination.parent) as temporary:
        archive_path = Path(temporary) / cubism_sdk.OFFICIAL_CUBISM_ARCHIVE_NAME
        cubism_sdk.download_official_cubism_archive(archive_path)
        cubism_sdk.extract_cubism_archive(archive_path, destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
