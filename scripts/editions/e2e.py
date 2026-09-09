"""Verify physical IFW selection and common-engine updates using an isolated fixture."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from apps.launcher.installer.build import build_installer
from scripts.editions.build import package


def main() -> None:
    """Install one selected game, update only the engine, and remove the isolated app."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ifw-root", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="physical-ifw-test-", dir=Path.cwd()) as temporary:
        root = Path(temporary)
        edition_id = root.name.replace("_", "-")
        work = root / "work"
        profile = work / "media/edition"
        profile.mkdir(parents=True)
        definition = {"id": edition_id, "name": "Physical installer verification", "games": ["selected-game", "unselected-game"]}
        content = json.dumps(definition).encode()
        (profile / "edition.json").write_bytes(content)
        (profile / "catalog.json").write_text(json.dumps({"games": [
            {"gameId": id, "name": id, "summary": "IFW test fixture"} for id in definition["games"]
        ]}), encoding="utf-8")
        (work / "snapshot.json").write_text("{}")
        install_tree = root / "engine"
        (install_tree / "bin").mkdir(parents=True)
        shutil.copy2(args.fixture, install_tree / "bin/PandD Game Launcher.exe")
        installer = package(work, install_tree, root / "distribution", "1.0.0", args.ifw_root)
        target = root / "installed"
        environment = dict(os.environ, PANDD_SAVE_DIR=str(root / "invocation"))

        # All IFW commands are bounded and keep the install root inside the disposable test directory
        def run(command, accepted=(0,)):
            """Preserve diagnostic output if a real installer operation fails."""
            result = subprocess.run([str(item) for item in command], env=environment, timeout=120,
                                    capture_output=True, text=True, encoding="utf-8", errors="replace")
            if result.returncode not in accepted:
                print(result.stdout, result.stderr)
                result.check_returncode()

        maintenance = target / "maintenancetool.exe"
        try:
            run([installer, "--root", target, "--accept-licenses", "--default-answer", "--confirm-command",
                 "install", "org.pandd.game.selected_game"])
            assert (target / "edition/edition.json").read_bytes() == content
            assert (root / "invocation/fixture-ran.txt").exists(), "Game import process was not invoked"
            assert (root / "invocation/selected-game.txt").read_text() == "selected-game"
            components = (target / "components.xml").read_text(encoding="utf-8")
            assert "org.pandd.game.selected_game" in components
            assert "org.pandd.game.unselected_game" not in components

            # A newer shared engine must preserve edition-owned files and component selections
            (install_tree / "new-engine.txt").write_text("2.0.0")
            repository = root / "update/repository"
            build_installer(args.ifw_root, install_tree, root / "update", "2.0.0", repository.as_uri())
            run([maintenance, "--set-temp-repository", repository.as_uri(), "--accept-licenses",
                 "--default-answer", "--confirm-command", "update", "org.pandd.launcher"], accepted=(0, 6))
            assert (target / "new-engine.txt").read_text() == "2.0.0"
            assert (target / "edition/edition.json").read_bytes() == content
            print("PASS: selective offline install and shared-engine update preserve the edition")
        finally:
            if maintenance.exists():
                run([maintenance, "--default-answer", "--confirm-command", "purge"])


if __name__ == "__main__":
    main()
