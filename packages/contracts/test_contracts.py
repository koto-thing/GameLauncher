"""Contract tests shared by reviewed sources and Publisher runtime validation."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator, FormatChecker

from services.deployment_publisher.publisher import validate_contract


class ContractTests(unittest.TestCase):
    """Prove checked-in metadata conforms to the exact schemas used for publication."""

    root = Path(__file__).resolve().parents[2]

    def test_all_schemas_are_valid_draft_2020_12(self) -> None:
        """Reject malformed schemas before they can give false confidence."""
        for path in sorted((self.root / "packages" / "contracts" / "schemas").glob("*.json")):
            with self.subTest(schema=path.name):
                schema = json.loads(path.read_text(encoding="utf-8"))
                Draft202012Validator.check_schema(schema)

    def test_reviewed_sources_match_runtime_contracts(self) -> None:
        """Validate every Git-managed source with Publisher's runtime validator."""
        source_contracts = {
            self.root / "packages/contracts/examples/game-release.source.json":
                "game-release-source.schema.json",
            self.root / "services/distribution-content/content/announcements/ja-JP.json":
                "announcements-source.schema.json",
            self.root / "services/distribution-content/content/announcements/en-US.json":
                "announcements-source.schema.json",
            self.root / "services/distribution-content/content/launcher/release.ja-JP.json":
                "launcher-release-source.schema.json",
            self.root / "services/distribution-content/content/launcher/release.en-US.json":
                "launcher-release-source.schema.json",
            self.root / "services/distribution-content/content/launcher/changelog.ja-JP.json":
                "launcher-changelog.schema.json",
            self.root / "services/distribution-content/content/launcher/changelog.en-US.json":
                "launcher-changelog.schema.json",
        }
        for path, schema in source_contracts.items():
            with self.subTest(source=path.name):
                validate_contract(json.loads(path.read_text(encoding="utf-8")), schema)

    def test_format_checker_rejects_non_rfc3339_time(self) -> None:
        """Ensure the installed format extras actively enforce UTC timestamp syntax."""
        schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "string",
            "format": "date-time",
        }
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        self.assertFalse(validator.is_valid("10 August 2026"))

    def test_public_urls_allow_http_only_for_exact_local_hosts(self) -> None:
        """Keep local static-server testing without weakening production transport rules."""
        schema = json.loads(
            (self.root / "packages" / "contracts" / "schemas" / "game-release.schema.json")
            .read_text(encoding="utf-8")
        )
        url_schema = schema["properties"]["files"]["items"]["properties"]["chunks"][
            "items"
        ]["properties"]["url"]
        validator = Draft202012Validator(url_schema, format_checker=FormatChecker())

        self.assertTrue(validator.is_valid("https://downloads.example/v1/blob"))
        self.assertTrue(validator.is_valid("http://127.0.0.1:8000/v1/blob"))
        self.assertTrue(validator.is_valid("http://localhost:8000/v1/blob"))
        self.assertFalse(validator.is_valid("http://notlocalhost.example/v1/blob"))
        self.assertFalse(validator.is_valid("http://downloads.example/v1/blob"))


if __name__ == "__main__":
    unittest.main()
