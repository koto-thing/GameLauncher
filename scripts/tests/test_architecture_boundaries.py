"""Verify that every deployable component has one trust-boundary owner."""

from __future__ import annotations

import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "infrastructure" / "trust-boundaries.json"


class ArchitectureBoundaryTests(unittest.TestCase):
    def test_components_exist_and_have_one_owner(self) -> None:
        document = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(document["version"], 1)
        self.assertEqual(set(document["boundaries"]), {"platform", "distribution", "operations"})

        owners: dict[str, str] = {}
        for boundary, definition in document["boundaries"].items():
            self.assertTrue(definition["deniedCapabilities"])
            for component in definition["components"]:
                self.assertNotIn(component, owners, f"{component} is owned by two trust boundaries")
                self.assertTrue((ROOT / component).is_dir(), f"missing component: {component}")
                owners[component] = boundary

        expected = {
            path.relative_to(ROOT).as_posix()
            for parent in (ROOT / "apps", ROOT / "services")
            for path in parent.iterdir()
            if path.is_dir()
        }
        self.assertEqual(set(owners), expected)


if __name__ == "__main__":
    unittest.main()
