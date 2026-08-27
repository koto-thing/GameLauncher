"""Seed the Publisher output with the current environment catalogs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import urllib.error
import urllib.request

from services.deployment_publisher.publisher import validate_contract, validate_locale_tag


def seed(metadata_path: Path, output: Path, base_url: str) -> None:
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    validate_contract(metadata, "game-release-source.schema.json")
    for locale in metadata["display"]:
        validate_locale_tag(locale)
        relative = f"v1/catalog/{locale}/windows/x86_64.json"
        request = urllib.request.Request(
            f"{base_url.rstrip('/')}/{relative}",
            headers={
                "Accept": "application/json",
                "Cache-Control": "no-cache",
                "User-Agent": "PandD-Game-Publisher",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                document = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code == 404:
                continue
            raise
        validate_contract(document, "catalog.schema.json")
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base-url", required=True)
    arguments = parser.parse_args()
    seed(arguments.metadata, arguments.output, arguments.base_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
