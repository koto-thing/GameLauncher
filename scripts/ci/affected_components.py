"""Select launcher validation conservatively from the actual event diff"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess


# Only independently deployed applications are known not to affect the launcher
INDEPENDENT = (
    "apps/music/", "apps/admin-web/", "apps/docs/", "apps/docs-worker/",
    "apps/launcher-download-web/", "apps/launcher-download-worker/",
    "services/platform-api/", "server/music/", "contracts/music/",
)


def launcher_required(paths: list[str]) -> bool:
    """Run for empty, unknown, shared, deleted and launcher-related changes"""
    return not paths or any(not path.startswith(INDEPENDENT) for path in paths)


def changed_paths(event: dict, event_name: str) -> list[str]:
    """Use the PR merge base or the full push range, including both rename paths"""
    if event_name == "pull_request":
        base = event["pull_request"]["base"]["sha"]
        head = event["pull_request"]["head"]["sha"]
        comparison = f"{base}...{head}"
    elif event_name == "push" and set(event["before"]) != {"0"}:
        comparison = f"{event['before']}..{event['after']}"
    else:
        return []

    output = subprocess.check_output(
        ["git", "diff", "--name-only", "--no-renames", "-z", comparison, "--"]
    )
    return [path for path in output.decode("utf-8").split("\0") if path]


def main() -> None:
    """Publish a decision and its evidence, running everything on diff errors"""
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    try:
        paths = changed_paths(event, os.environ["GITHUB_EVENT_NAME"])
    except (KeyError, subprocess.CalledProcessError, UnicodeError) as error:
        print(f"Cannot determine changed paths; running all launcher checks: {error}")
        paths = []

    required = launcher_required(paths)
    print(json.dumps({"launcher": required, "paths": paths}, ensure_ascii=False))
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"launcher={str(required).lower()}\n")


if __name__ == "__main__":
    main()
