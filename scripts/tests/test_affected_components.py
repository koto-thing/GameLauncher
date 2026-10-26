"""Exercise conservative selection and real Git delete/rename/stacked PR diffs"""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts.ci.affected_components import changed_paths, launcher_required


class AffectedComponentsTests(unittest.TestCase):
    """Keep shared dependencies and unknown paths in launcher validation"""

    def test_independent_changes(self):
        """Only independently deployed application changes may skip the launcher"""
        self.assertFalse(launcher_required(["apps/music/src/a.ts", "services/platform-api/src/a.ts"]))
        for path in ("CMakeLists.txt", "Cargo.lock", "rust-toolchain.toml", "cmake/Rust.cmake",
                     "packages/transfer/src/lib.rs", "packages/contracts/schemas/a.json",
                     "docs/PRIVACY_POLICY.md", "assets/images/logo.png", ".github/workflows/ci.yml",
                     "unknown", "apps/launcher/src/a.cpp"):
            with self.subTest(path=path):
                self.assertTrue(launcher_required(["apps/music/src/a.ts", path]))
        self.assertTrue(launcher_required([]))

    def test_stacked_pr_rename_and_deletion(self):
        """Diff the actual PR base and preserve the old path when a file moves"""
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                """Run isolated Git commands without user configuration"""
                return subprocess.check_output(["git", "-C", directory, *args], stderr=subprocess.DEVNULL).decode().strip()

            git("init")
            git("config", "user.email", "ci@example.invalid")
            git("config", "user.name", "CI test")
            root = Path(directory)
            (root / "shared.txt").write_text("shared")
            git("add", ".")
            git("commit", "-m", "base")
            base = git("rev-parse", "HEAD")
            (root / "apps/music").mkdir(parents=True)
            git("mv", "shared.txt", "apps/music/moved.txt")
            git("commit", "-m", "move")
            head = git("rev-parse", "HEAD")
            previous = Path.cwd()
            try:
                os.chdir(root)
                paths = changed_paths({"pull_request": {"base": {"sha": base}, "head": {"sha": head}}}, "pull_request")
                self.assertIn("shared.txt", paths)
                self.assertIn("apps/music/moved.txt", paths)
                self.assertTrue(launcher_required(paths))
                git("rm", "apps/music/moved.txt")
                git("commit", "-m", "delete")
                paths = changed_paths({"before": head, "after": git("rev-parse", "HEAD")}, "push")
                self.assertEqual(paths, ["apps/music/moved.txt"])
            finally:
                os.chdir(previous)

    def test_manual_and_new_branch_run_all(self):
        """Manual runs and missing push history must not skip checks"""
        self.assertEqual(changed_paths({}, "workflow_dispatch"), [])
        self.assertEqual(changed_paths({"before": "0" * 40}, "push"), [])


if __name__ == "__main__":
    unittest.main()
