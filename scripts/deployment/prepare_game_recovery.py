"""Pin recovery to a previously verified manifest before promoting any pointers."""

import argparse
from scripts.deployment.verify_game_publication import read_json
import hashlib
import json
from pathlib import Path

from packages.contracts.validation import canonical_json, validate_contract, validate_locale_tag


def prepare(snapshot: dict, metadata: dict, public_tree: Path, base_url: str) -> None:
    """Reject changed release contents and unlist a suspended game without deleting files."""
    recovery = snapshot.get("recovery")
    if recovery is None:
        return
    if recovery.get("mode") not in {"rollback", "suspend", "resume"}:
        raise ValueError("invalid recovery mode")
    game_id = metadata["gameId"]
    version = metadata["version"]
    relative = f"v1/games/{game_id}/releases/windows/x86_64/{version}/manifest.json"
    manifest = json.loads((public_tree / relative).read_text(encoding="utf-8"))
    validate_contract(manifest, "game-release.schema.json")
    if hashlib.sha256(canonical_json(manifest)).hexdigest() != recovery.get("manifestSha256"):
        raise ValueError("recovery manifest differs from the previously verified successful release")
    if recovery["mode"] == "suspend":
        latest, _ = read_json(f"{base_url.rstrip('/')}/v1/games/{game_id}/releases/windows/x86_64/latest.json")
        if canonical_json(latest) != canonical_json(manifest):
            raise ValueError("suspension must target the currently published successful version")
        for locale in metadata["display"]:
            validate_locale_tag(locale)
            path = public_tree / f"v1/catalog/{locale}/windows/x86_64.json"
            catalog = json.loads(path.read_text(encoding="utf-8"))
            catalog["games"] = [game for game in catalog["games"] if game["gameId"] != game_id]
            validate_contract(catalog, "catalog.schema.json")
            path.write_bytes(canonical_json(catalog) + b"\n")


def main() -> int:
    """Read only the authenticated preflight snapshot and validated local publication tree."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--public-tree", type=Path, required=True)
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()
    prepare(json.loads(args.snapshot.read_text(encoding="utf-8")), json.loads(args.metadata.read_text(encoding="utf-8")), args.public_tree, args.base_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
