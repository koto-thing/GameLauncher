"""Authenticated resumable multipart client for the private intake service."""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import time
from typing import Callable
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

from pandd_intake_uploader.application import ArtifactCancelled, CancellationToken, ValidationError


Progress = Callable[[int, str, str], None]


class IntakeClient:
    def __init__(self, control_plane_url: str):
        self.base_url = control_plane_url.rstrip("/")
        self._token = ""

    def upload(self, descriptor_path: Path, progress: Progress,
               cancellation: CancellationToken) -> None:
        descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
        archive = descriptor_path.parent / descriptor["artifactFile"]
        if not archive.is_file():
            raise ValidationError(f"artifact ZIPが見つかりません: {archive.name}")
        if archive.stat().st_size != descriptor["sizeBytes"]:
            raise ValidationError("artifact ZIPの容量がdescriptorと一致しません")
        digest = hashlib.sha256()
        verified_bytes = 0
        with archive.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                if cancellation.is_requested():
                    raise ArtifactCancelled("artifact検証をキャンセルしました")
                digest.update(block)
                verified_bytes += len(block)
                progress(
                    86 + round(verified_bytes / descriptor["sizeBytes"] * 3),
                    "artifactを再検証しています",
                    f"{verified_bytes / (1024 ** 2):,.1f} / "
                    f"{descriptor['sizeBytes'] / (1024 ** 2):,.1f} MiB",
                )
        if digest.hexdigest() != descriptor["sha256"]:
            raise ValidationError("artifact ZIPのSHA-256がdescriptorと一致しません")
        self._token = self._authenticate(progress, cancellation)
        session = self._json_request("POST", "/api/intake/uploads", descriptor)
        part_size = int(session["partSize"])
        part_count = int(session["partCount"])
        uploaded = {int(value) for value in session["uploadedParts"]}
        pending = [number for number in range(1, part_count + 1) if number not in uploaded]
        for offset in range(0, len(pending), 4):
            self._check_cancel(cancellation, descriptor["artifactId"])
            batch = pending[offset:offset + 4]
            signed = self._json_request(
                "POST", f"/api/intake/uploads/{descriptor['artifactId']}/parts",
                {"partNumbers": batch},
            )
            transport = signed["transport"]
            urls = {int(item["partNumber"]): item["url"] for item in signed["parts"]}
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                futures = {
                    executor.submit(
                        self._upload_part, archive, number, part_size, urls[number], transport,
                    ): number for number in batch
                }
                for future in concurrent.futures.as_completed(futures):
                    number = futures[future]
                    try:
                        etag, size_bytes = future.result()
                    except Exception:
                        cancellation.request()
                        raise
                    if transport == "direct-r2":
                        self._json_request(
                            "POST", f"/api/intake/uploads/{descriptor['artifactId']}/parts",
                            {"completed": {
                                "partNumber": number, "etag": etag, "sizeBytes": size_bytes,
                            }},
                        )
                    uploaded.add(number)
                    progress(
                        90 + round(len(uploaded) / part_count * 8),
                        "非公開intakeへuploadしています",
                        f"{len(uploaded)} / {part_count} parts 完了",
                    )
        self._check_cancel(cancellation, descriptor["artifactId"])
        progress(99, "artifactをsealしています", "R2 objectの容量とpart一覧を検証しています")
        self._json_request("POST", f"/api/intake/uploads/{descriptor['artifactId']}/seal", {})
        progress(100, "intake uploadが完了しました", "Webアプリから申請を作成できます")

    def _authenticate(self, progress: Progress, cancellation: CancellationToken) -> str:
        config = self._json_request("GET", "/api/intake/config", authenticated=False)
        if config.get("localDevelopment"):
            role = os.environ.get("PANDD_LOCAL_DEV_ROLE", "maintainer")
            if role not in {"admin", "maintainer"}:
                raise ValidationError("PANDD_LOCAL_DEV_ROLEはadminまたはmaintainerを指定してください")
            return f"local-development:{role}"
        client_id = config.get("githubClientId")
        if not client_id:
            raise ValidationError("control planeにGitHub App Client IDが設定されていません")
        device = self._github_request(
            "https://github.com/login/device/code",
            {"client_id": client_id},
        )
        progress(
            89, "GitHubで本人確認してください",
            f"{device['verification_uri']} でコード {device['user_code']} を入力してください",
        )
        webbrowser.open(device["verification_uri"])
        interval = max(5, int(device.get("interval", 5)))
        deadline = time.monotonic() + int(device["expires_in"])
        while time.monotonic() < deadline:
            if cancellation.wait(interval):
                raise ArtifactCancelled("GitHub認証をキャンセルしました")
            result = self._github_request(
                "https://github.com/login/oauth/access_token",
                {
                    "client_id": client_id,
                    "device_code": device["device_code"],
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                },
            )
            if result.get("access_token"):
                return result["access_token"]
            error = result.get("error")
            if error == "authorization_pending":
                continue
            if error == "slow_down":
                interval += 5
                continue
            raise ValidationError("GitHub Device Flowを完了できませんでした")
        raise ValidationError("GitHub Device Flowの有効期限が切れました")

    @staticmethod
    def _github_request(url: str, form: dict) -> dict:
        request = urllib.request.Request(
            url,
            data=urllib.parse.urlencode(form).encode("ascii"),
            headers={"Accept": "application/json", "User-Agent": "PandD-Intake-Uploader"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, json.JSONDecodeError) as error:
            raise ValidationError("GitHubへ接続できませんでした") from error

    def _json_request(self, method: str, path: str, payload: dict | None = None,
                      authenticated: bool = True) -> dict:
        headers = {"Accept": "application/json", "User-Agent": "PandD-Intake-Uploader"}
        if authenticated:
            headers["Authorization"] = f"Bearer {self._token}"
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read().decode("utf-8")).get("error")
            except (json.JSONDecodeError, UnicodeDecodeError):
                message = None
            raise ValidationError(message or f"control planeがHTTP {error.code}を返しました") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise ValidationError("control planeへ接続できませんでした") from error

    def _upload_part(self, archive: Path, part_number: int, part_size: int,
                     url: str, transport: str) -> tuple[str, int]:
        offset = (part_number - 1) * part_size
        size = min(part_size, archive.stat().st_size - offset)
        with archive.open("rb") as source:
            source.seek(offset)
            data = source.read(size)
        headers = {"Content-Length": str(size), "User-Agent": "PandD-Intake-Uploader"}
        if transport == "worker-proxy":
            headers["Authorization"] = f"Bearer {self._token}"
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, data=data, headers=headers, method="PUT")
                with urllib.request.urlopen(request, timeout=180) as response:
                    if transport == "worker-proxy":
                        result = json.loads(response.read().decode("utf-8"))
                        return result["etag"], size
                    etag = response.headers.get("ETag", "").strip('"')
                    if not etag:
                        raise ValidationError("R2がpart ETagを返しませんでした")
                    return etag, size
            except (urllib.error.URLError, TimeoutError) as error:
                if attempt == 2:
                    raise ValidationError(f"part {part_number} のuploadに失敗しました") from error
                time.sleep(2 ** attempt)
        raise AssertionError("unreachable")

    def _check_cancel(self, cancellation: CancellationToken, artifact_id: str) -> None:
        if not cancellation.is_requested():
            return
        try:
            self._json_request("DELETE", f"/api/intake/uploads/{artifact_id}")
        finally:
            raise ArtifactCancelled("intake uploadをキャンセルしました")
