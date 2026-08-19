"""Verify the published manifest and every localized catalog over the public URL."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

from publisher.publisher import canonical_json, validate_contract, validate_locale_tag


def read_json(url: str) -> tuple[dict, bytes]:
    separator = "&" if "?" in url else "?"
    request = urllib.request.Request(
        url + separator + urllib.parse.urlencode({"verify": "1"}),
        headers={"Accept": "application/json", "Cache-Control": "no-cache"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read()
    return json.loads(content.decode("utf-8")), content


def verify(metadata_path: Path, public_tree: Path, base_url: str) -> str:
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    game_id = metadata["gameId"]
    version = metadata["version"]
    relative = f"v1/games/{game_id}/releases/windows/x86_64/{version}/manifest.json"
    local_manifest = json.loads((public_tree / relative).read_text(encoding="utf-8"))
    remote_manifest, _ = read_json(f"{base_url.rstrip('/')}/{relative}")
    validate_contract(remote_manifest, "game-release.schema.json")
    if canonical_json(local_manifest) != canonical_json(remote_manifest):
        raise ValueError("public manifest differs from the signed local manifest")
    latest_relative = f"v1/games/{game_id}/releases/windows/x86_64/latest.json"
    remote_latest, _ = read_json(f"{base_url.rstrip('/')}/{latest_relative}")
    if canonical_json(remote_latest) != canonical_json(remote_manifest):
        raise ValueError("public latest pointer differs from the signed manifest")
    for locale in metadata["display"]:
        validate_locale_tag(locale)
        catalog_url = f"{base_url.rstrip('/')}/v1/catalog/{locale}/windows/x86_64.json"
        catalog, _ = read_json(catalog_url)
        validate_contract(catalog, "catalog.schema.json")
        entry = next((item for item in catalog["games"] if item["gameId"] == game_id), None)
        expected_latest_url = f"{base_url.rstrip('/')}/{latest_relative}"
        if not entry or entry["latestReleaseUrl"] != expected_latest_url:
            raise ValueError(f"published catalog is invalid: {locale}")
    return hashlib.sha256(canonical_json(remote_manifest)).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--public-tree", type=Path, required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--digest-output", type=Path, required=True)
    arguments = parser.parse_args()
    digest = verify(arguments.metadata, arguments.public_tree, arguments.base_url)
    arguments.digest_output.write_text(digest + "\n", encoding="ascii")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
