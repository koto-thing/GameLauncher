#!/usr/bin/env python3
"""Build a Qt IFW online installer and update repository from an install tree."""

from __future__ import annotations

import argparse
import datetime as dt
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET


def executable(root: Path | None, name: str) -> Path:
    """Resolve a Qt IFW executable from an explicit root or the configured PATH."""
    suffix = ".exe" if os.name == "nt" else ""
    if root is not None:
        path = root / "bin" / f"{name}{suffix}"
        if not path.exists():
            raise FileNotFoundError(path)
        return path
    discovered = shutil.which(f"{name}{suffix}")
    if not discovered:
        raise FileNotFoundError(f"{name}{suffix} was not found on PATH")
    return Path(discovered)


def configure_metadata(config: Path, package: Path, version: str,
                       repository_url: str) -> None:
    """Set release-specific version, date, and immutable environment repository URL."""
    config_tree = ET.parse(config)
    config_root = config_tree.getroot()
    config_root.find("Version").text = version
    config_root.find("RemoteRepositories/Repository/Url").text = repository_url.rstrip("/")
    config_tree.write(config, encoding="utf-8", xml_declaration=True)

    package_tree = ET.parse(package)
    package_root = package_tree.getroot()
    package_root.find("Version").text = version
    package_root.find("ReleaseDate").text = dt.date.today().isoformat()
    package_tree.write(package, encoding="utf-8", xml_declaration=True)


def build_installer(ifw_root: Path | None, install_tree: Path, output: Path,
                    version: str, repository_url: str) -> Path:
    """Create one platform-native online installer and its matching repository."""
    root = Path(__file__).resolve().parent
    output.mkdir(parents=True, exist_ok=True)
    repository = output / "repository"
    if repository.exists():
        shutil.rmtree(repository)

    # Source metadata remains reproducible while release values live in a disposable work tree
    with tempfile.TemporaryDirectory() as temporary:
        work = Path(temporary)
        packages = work / "packages"
        config_dir = work / "config"
        config = config_dir / "config.xml"
        shutil.copytree(root / "packages", packages)
        shutil.copytree(root / "config", config_dir)
        shutil.copy2(root.parent / "assets/images/PandDLogo.png",
                     config_dir / "PandDLogo.png")
        data = packages / "org.pandd.launcher" / "data"
        shutil.copytree(install_tree, data)
        configure_metadata(config, packages / "org.pandd.launcher/meta/package.xml",
                           version, repository_url)
        subprocess.run([executable(ifw_root, "repogen"), "-p", packages, repository],
                       check=True)
        installer = output / "PandD-Game-Launcher-Online-Installer"
        subprocess.run([executable(ifw_root, "binarycreator"), "--online-only",
                        "-c", config, "-p", packages,
                        installer], check=True)
    return installer


def main() -> int:
    """Populate package data, run repogen, then create an online installer."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ifw-root", type=Path)
    parser.add_argument("--install-tree", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--repository-url", required=True)
    arguments = parser.parse_args()
    build_installer(arguments.ifw_root, arguments.install_tree, arguments.output,
                    arguments.version, arguments.repository_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
