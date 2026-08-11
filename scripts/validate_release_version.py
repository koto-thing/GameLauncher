#!/usr/bin/env python3
"""Require one release version across CMake, localized metadata, and changelogs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")


def validate_release_version(value: str) -> str:
    """Return normalized SemVer only when every release identity matches it."""
    version = value.removeprefix("v")
    if not SEMVER.fullmatch(version):
        raise ValueError("release version must be SemVer with an optional v tag prefix")

    cmake = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
    match = re.search(r"project\(PandDGameLauncher VERSION ([^ )]+)", cmake)
    if match is None or match.group(1) != version:
        raise ValueError(f"CMake project version does not match {version}")

    content = ROOT / "backend" / "content" / "launcher"
    for locale in ("ja-JP", "en-US"):
        release_path = content / f"release.{locale}.json"
        release = json.loads(release_path.read_text(encoding="utf-8"))
        if release.get("version") != version:
            raise ValueError(f"{release_path.name} does not match {version}")

        changelog_path = content / f"changelog.{locale}.json"
        changelog = json.loads(changelog_path.read_text(encoding="utf-8"))
        versions = {entry.get("version") for entry in changelog.get("releases", [])}
        if version not in versions:
            raise ValueError(f"{changelog_path.name} has no {version} entry")
    return version


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    arguments = parser.parse_args()
    print(validate_release_version(arguments.version))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
