#!/usr/bin/env python3
"""Install, smoke-test, and purge an online IFW package from a local repository."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from installer.build import build_installer


def platform_executable(base: Path) -> Path:
    """Resolve the executable emitted by binarycreator for the current host."""
    if os.name == "nt":
        return base.with_suffix(".exe")
    if sys.platform == "darwin":
        return base.with_suffix(".app") / "Contents" / "MacOS" / base.name
    return base


def installed_launcher(root: Path) -> Path:
    """Resolve the launcher executable inside an IFW installation root."""
    if os.name == "nt":
        return root / "bin" / "PandD Game Launcher.exe"
    if sys.platform == "darwin":
        return root / "PandD Game Launcher.app" / "Contents" / "MacOS" / "PandD Game Launcher"
    return root / "bin" / "PandD Game Launcher"


def maintenance_tool(root: Path) -> Path:
    """Resolve the platform-native Qt IFW maintenance tool."""
    if os.name == "nt":
        return root / "maintenancetool.exe"
    if sys.platform == "darwin":
        return root / "maintenancetool.app" / "Contents" / "MacOS" / "maintenancetool"
    return root / "maintenancetool"


def run_checked(arguments: list[os.PathLike[str] | str], environment: dict[str, str]) -> None:
    """Run one bounded E2E process and preserve its output on failure."""
    subprocess.run([str(value) for value in arguments], check=True, env=environment,
                   timeout=300)


def main() -> int:
    """Exercise initial install, deployed startup, and full launcher uninstallation."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ifw-root", type=Path)
    parser.add_argument("--install-tree", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    arguments = parser.parse_args()

    output = arguments.output.resolve()
    repository_url = (output / "repository").as_uri()
    installer_base = build_installer(arguments.ifw_root, arguments.install_tree.resolve(),
                                     output, arguments.version, repository_url)
    installer = platform_executable(installer_base)
    if not installer.exists():
        raise FileNotFoundError(f"binarycreator did not produce {installer}")

    environment = os.environ.copy()
    if os.name != "nt":
        environment["QT_QPA_PLATFORM"] = "offscreen"

    # Qt IFW rejects Windows 8.3 short paths such as C:\\Users\\RUNNER~1. The
    # checked-out workspace has a stable long path on every CI runner.
    with tempfile.TemporaryDirectory(prefix="pandd-ifw-e2e-", dir=Path.cwd()) as temporary:
        temporary_root = Path(temporary)
        target = temporary_root / "launcher"
        cache = temporary_root / "cache"
        preserved_game = temporary_root / "game-data" / "save.sav"
        preserved_game.parent.mkdir(parents=True)
        preserved_game.write_bytes(b"must survive launcher uninstallation")

        # The generated online installer reads only the adjacent file:// repository.
        run_checked([installer, "--root", target, "--cache-path", cache, "--no-proxy",
                     "--accept-licenses", "--default-answer", "--confirm-command",
                     "install", "org.pandd.launcher"], environment)
        launcher = installed_launcher(target)
        if not launcher.is_file():
            raise FileNotFoundError(f"installed launcher is missing: {launcher}")

        smoke_environment = environment.copy()
        smoke_environment["PANDD_SMOKE_TEST"] = "1"
        run_checked([launcher, "--smoke-test"], smoke_environment)

        tool = maintenance_tool(target)
        if not tool.is_file():
            raise FileNotFoundError(f"maintenance tool is missing: {tool}")
        run_checked([tool, "--default-answer", "--confirm-command", "purge"], environment)

        # Windows may schedule maintenance-tool self-deletion after the command returns.
        for _ in range(100):
            if not launcher.exists():
                break
            time.sleep(0.1)
        if launcher.exists():
            raise RuntimeError("launcher remained after Qt IFW purge")
        if not preserved_game.is_file():
            raise RuntimeError("launcher purge removed game/save data outside its installation")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
