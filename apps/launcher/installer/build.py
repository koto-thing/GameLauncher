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

from apps.launcher.installer.timing import phase


def executable(root: Path | None, name: str) -> Path:
    """Resolve a Qt IFW executable from an explicit root or the configured PATH."""
    # Select the platform executable suffix
    suffix = ".exe" if os.name == "nt" else ""

    # Resolve from the explicit IFW root when provided
    if root is not None:
        path = root / "bin" / f"{name}{suffix}"
        if not path.exists():
            raise FileNotFoundError(path)
        return path
    # Otherwise resolve the executable from PATH
    discovered = shutil.which(f"{name}{suffix}")
    if not discovered:
        raise FileNotFoundError(f"{name}{suffix} was not found on PATH")
    return Path(discovered)


def configure_metadata(config: Path, package: Path, version: str,
                       repository_url: str) -> None:
    """Set release-specific version, date, and immutable environment repository URL."""
    # Update installer-level metadata
    config_tree = ET.parse(config)
    config_root = config_tree.getroot()
    config_root.find("Version").text = version
    config_root.find("RemoteRepositories/Repository/Url").text = repository_url.rstrip("/")
    config_tree.write(config, encoding="utf-8", xml_declaration=True)

    # Update package-level metadata
    package_tree = ET.parse(package)
    package_root = package_tree.getroot()
    package_root.find("Version").text = version
    package_root.find("ReleaseDate").text = dt.date.today().isoformat()
    package_tree.write(package, encoding="utf-8", xml_declaration=True)


def build_installer(ifw_root: Path | None, install_tree: Path, output: Path,
                    version: str, repository_url: str, *, compression: int | None = None) -> Path:
    """Create one platform-native online installer and its matching repository."""
    # Reject invalid compression before creating output files
    if compression not in (None, 0, 1, 3, 5, 7, 9):
        raise ValueError("Unsupported Qt IFW compression level")
    compression_arguments = [] if compression is None else ["--compression", str(compression)]

    # Prepare the disposable build workspace
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
        shutil.copy2(root.parents[2] / "assets/images/PandDLogo.png",
                     config_dir / "PandDLogo.png")
        # Windows では installer と maintenance tool の exe のアイコンもロゴにする
        if os.name == "nt":
            set_application_icon(config, root.parents[2] / "assets/images/PandDLogo.ico")
        data = packages / "org.pandd.launcher" / "data"
        with phase("copy install tree"):
            shutil.copytree(install_tree, data)
        # Apply release metadata before generating the repository
        configure_metadata(config, packages / "org.pandd.launcher/meta/package.xml",
                           version, repository_url)

        # Generate the repository and online installer
        with phase("repogen"):
            subprocess.run([executable(ifw_root, "repogen"), *compression_arguments,
                            "-p", packages, repository], check=True)
        installer = output / "PandD-Game-Launcher-Online-Installer"
        with phase("binarycreator"):
            subprocess.run([executable(ifw_root, "binarycreator"), "--online-only",
                            "-c", config, "-p", packages, installer], check=True)

        # Record archive size alongside timings so faster compression can be compared fairly
        repository_bytes = sum(path.stat().st_size for path in repository.rglob("*") if path.is_file())
        print(f"IFW repository bytes: {repository_bytes}", flush=True)
    return installer


def set_application_icon(config: Path, icon: Path) -> None:
    """IFW の installer と maintenance tool の exe に付けるアイコンを設定する

    IFW は InstallerApplicationIcon の名前に Windows では .ico を付けて探すので、
    アイコンを config の隣に置き、拡張子なしの名前を登録する

    Args:
        config: 作業用にコピーした config.xml
        icon: 埋め込む .ico ファイル
    """
    # アイコンを config の隣へ置く
    shutil.copy2(icon, config.parent / icon.name)

    # 拡張子なしの名前を config.xml に書き込む
    tree = ET.parse(config)
    ET.SubElement(tree.getroot(), "InstallerApplicationIcon").text = icon.stem
    tree.write(config, encoding="utf-8", xml_declaration=True)


def wrap_windows_installer(installer: Path) -> Path:
    """IFW installer を PandD Setup の画面に埋め込み、公開用のファイル名で置き直す

    Args:
        installer: binarycreator が出力した installer の拡張子なしのパス

    Returns:
        公開用 installer の拡張子なしのパス。中身は PandD Setup になる

    Raises:
        subprocess.CalledProcessError: PandD Setup の build に失敗した場合
    """
    # IFW 本体は監査できるよう公開用 installer の隣に別名で残す
    public = installer.with_suffix(".exe")
    engine = installer.with_name("PandD-Game-Launcher-IFW-Installer.exe")
    public.replace(engine)

    # IFW 本体をインストール処理として埋め込んだ PandD Setup を build する
    root = Path(__file__).resolve().parents[3]
    environment = os.environ.copy()
    environment["PANDD_IFW_INSTALLER"] = str(engine.resolve())
    subprocess.run(["cargo", "build", "--locked", "--release", "-p", "pandd-setup"],
                   check=True, cwd=root, env=environment)
    shutil.copy2(root / "target" / "release" / "pandd-setup.exe", public)
    return installer


def main() -> int:
    """package data を用意して repogen と binarycreator を実行する

    Windows では作った installer を PandD Setup の画面で包む

    Returns:
        正常終了なら 0
    """
    # Parse release build arguments
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ifw-root", type=Path)
    parser.add_argument("--install-tree", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--repository-url", required=True)
    arguments = parser.parse_args()
    # Build the installer from the supplied install tree
    installer = build_installer(arguments.ifw_root, arguments.install_tree, arguments.output,
                                arguments.version, arguments.repository_url)
    # Windows では PandD Setup の画面からインストールする
    if os.name == "nt":
        wrap_windows_installer(installer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
