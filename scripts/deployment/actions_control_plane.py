"""Exchange GitHub Actions OIDC tokens with the PandD control plane."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


AUDIENCE = "pandd-control-plane"


def oidc_token() -> str:
    endpoint = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
    request_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
    if not endpoint or not request_token:
        raise RuntimeError("GitHub Actions OIDC is unavailable")
    separator = "&" if "?" in endpoint else "?"
    request = urllib.request.Request(
        endpoint + separator + urllib.parse.urlencode({"audience": AUDIENCE}),
        headers={"Authorization": f"Bearer {request_token}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        value = json.loads(response.read().decode("utf-8")).get("value")
    if not value:
        raise RuntimeError("GitHub Actions OIDC token was not returned")
    return value


def control_plane_request(path: str, payload: dict) -> dict:
    base_url = os.environ.get("DEPLOYMENT_CONTROL_PLANE_URL", "").rstrip("/")
    if not base_url.startswith("https://"):
        raise RuntimeError("DEPLOYMENT_CONTROL_PLANE_URL must use HTTPS")
    request = urllib.request.Request(
        base_url + path,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {oidc_token()}",
            "Content-Type": "application/json",
            "User-Agent": "PandD-Deployment-Workflow",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            message = json.loads(error.read().decode("utf-8")).get("error")
        except (json.JSONDecodeError, UnicodeDecodeError):
            message = None
        raise RuntimeError(message or f"control plane returned HTTP {error.code}") from error


def main() -> int:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    authorize = commands.add_parser("authorize")
    authorize.add_argument("--request-id", required=True)
    authorize.add_argument("--attempt-id", required=True)
    preflight = commands.add_parser("preflight")
    preflight.add_argument("--request-id", required=True)
    preflight.add_argument("--attempt-id", required=True)
    preflight.add_argument("--snapshot-output", type=Path, required=True)
    preflight.add_argument("--artifact-output", type=Path, required=True)
    status = commands.add_parser("status")
    status.add_argument("--request-id", required=True)
    status.add_argument("--attempt-id", required=True)
    status.add_argument("--stage", required=True)
    status.add_argument("--result")
    status.add_argument("--manifest-sha256")
    status.add_argument("--published-object-count", type=int)
    arguments = parser.parse_args()
    if arguments.command in {"authorize", "preflight"}:
        result = control_plane_request("/api/actions/preflight", {
            "requestId": arguments.request_id,
            "attemptId": arguments.attempt_id,
        })
        if arguments.command == "authorize":
            return 0
        download_url = result["artifact"].pop("downloadUrl")
        download = urllib.request.Request(
            download_url, headers={"User-Agent": "PandD-Deployment-Workflow"}
        )
        with urllib.request.urlopen(download, timeout=300) as response, \
                arguments.artifact_output.open("xb") as target:
            while block := response.read(1024 * 1024):
                target.write(block)
        arguments.snapshot_output.write_text(
            json.dumps(result, separators=(",", ":")), encoding="utf-8"
        )
        try:
            os.chmod(arguments.snapshot_output, 0o600)
            os.chmod(arguments.artifact_output, 0o600)
        except OSError:
            pass
        return 0
    payload = {
        "requestId": arguments.request_id,
        "attemptId": arguments.attempt_id,
        "stage": arguments.stage,
    }
    if arguments.result:
        payload["result"] = arguments.result
    if arguments.manifest_sha256:
        payload["manifestSha256"] = arguments.manifest_sha256
    if arguments.published_object_count is not None:
        payload["publishedObjectCount"] = arguments.published_object_count
    control_plane_request("/api/actions/status", payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
