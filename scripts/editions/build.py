"""Freeze public Windows releases and create a physical distribution with Qt IFW."""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from apps.launcher.installer.build import executable, configure_metadata
from scripts.deployment.actions_control_plane import control_plane_request
from services.deployment_publisher.publisher import (
    CHUNK_SIZE, canonical_json, find_openssl, sign_payload, validate_contract, validate_relative_path,
)

ORIGIN = "https://downloads.koto-thing.com"
ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "apps/launcher/installer"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow redirects from the fixed production origin."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        """Reject a redirect before contacting its destination."""
        raise ValueError("Distribution redirects are forbidden")


def download(url: str, maximum: int) -> bytes:
    """Read bounded content from the production origin only."""
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.netloc != "downloads.koto-thing.com"
            or parsed.query or parsed.fragment or not parsed.path.startswith("/v1/")):
        raise ValueError("Untrusted production URL")
    with urllib.request.build_opener(NoRedirect()).open(url, timeout=60) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError("Distribution response exceeds its size limit")
    return data


def verify_release(data: bytes, public_key: str, game_id: str) -> dict:
    """Verify the production signature and contract before downloading any payload."""
    release = json.loads(data)
    validate_contract(release, "game-release.schema.json")
    if (release["gameId"] != game_id or release["platform"] != "windows" or release["arch"] != "x86_64"):
        raise ValueError("Release identity or platform mismatch")
    unsigned = {key: value for key, value in release.items() if key != "signature"}
    key = base64.b64decode(public_key, validate=True)
    if len(key) != 32:
        raise ValueError("Invalid Ed25519 public key")
    with tempfile.TemporaryDirectory() as temporary:
        folder = Path(temporary)
        (folder / "key.der").write_bytes(bytes.fromhex("302a300506032b6570032100") + key)
        (folder / "payload").write_bytes(canonical_json(unsigned))
        (folder / "signature").write_bytes(base64.b64decode(release["signature"], validate=True))
        subprocess.run([find_openssl(), "pkeyutl", "-verify", "-rawin", "-pubin", "-keyform", "DER",
                        "-inkey", str(folder / "key.der"), "-in", str(folder / "payload"),
                        "-sigfile", str(folder / "signature")], check=True, capture_output=True)
    return release


def write_json(path: Path, value: dict) -> None:
    """Write reproducible UTF-8 JSON to the build directory."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json(value))


def freeze(work: Path, edition_id: str, build_id: str, public_key: str) -> None:
    """Bind the Actions run and snapshot all latest manifests before long build steps."""
    preflight = control_plane_request("/api/actions/editions", {
        "action": "preflight", "editionId": edition_id, "buildId": build_id,
    })
    definition = preflight["definition"]
    if definition["id"] != edition_id or not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,63}", edition_id):
        raise ValueError("Invalid edition identity")
    work.mkdir(parents=True, exist_ok=True)
    write_json(work / "definition.json", definition)
    catalog = json.loads(download(f"{ORIGIN}/v1/catalog/ja-JP/windows/x86_64.json", 8 * 1024 * 1024))
    validate_contract(catalog, "catalog.schema.json")
    by_id = {game["gameId"]: game for game in catalog["games"]}
    catalog["games"] = [by_id[game_id] for game_id in definition["games"]]
    profile = work / "media/edition"
    profile.mkdir(parents=True, exist_ok=True)
    write_json(profile / "catalog.json", catalog)
    snapshot = {"buildId": build_id, "games": []}
    for game in catalog["games"]:
        game_id = game["gameId"]
        data = download(game["latestReleaseUrl"], 16 * 1024 * 1024)
        release = verify_release(data, public_key, game_id)
        (profile / f"release-{game_id}.json").write_bytes(data)
        snapshot["games"].append({"gameId": game_id, "version": release["version"],
                                  "manifestSha256": hashlib.sha256(data).hexdigest()})
    for name, data in preflight["images"].items():
        if name not in ("logo", "background"):
            raise ValueError("Unexpected edition image")
        (profile / f"{name}.png").write_bytes(base64.b64decode(data, validate=True))
    write_json(work / "snapshot.json", snapshot)
    control_plane_request("/api/actions/editions", {
        "action": "status", "buildId": build_id, "state": "running", "snapshot": snapshot,
    })


def materialize_game(release: dict, destination: Path, fetcher=download) -> None:
    """Reassemble signed chunks, checking file paths, offsets, sizes and hashes."""
    names = set()
    total = 0
    for item in release["files"]:
        relative = validate_relative_path(item["path"])
        # Windows aliases and device names must never escape or collide on the media
        for part in relative.parts:
            if (part.endswith((" ", ".")) or re.search(r'[<>:"|?*\x00-\x1f]', part)
                    or re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", part)):
                raise ValueError("Unsafe Windows path")
        folded = str(relative).casefold()
        if folded in names:
            raise ValueError("Duplicate Windows file path")
        names.add(folded)
        path = destination / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        offset = 0
        digest = hashlib.sha256()
        with path.open("xb") as output:
            for chunk in item["chunks"]:
                if chunk["offset"] != offset or chunk["size"] > CHUNK_SIZE:
                    raise ValueError("Invalid chunk layout")
                data = fetcher(chunk["url"], chunk["size"])
                if len(data) != chunk["size"] or hashlib.sha256(data).hexdigest() != chunk["sha256"]:
                    raise ValueError("Chunk checksum mismatch")
                output.write(data)
                digest.update(data)
                offset += len(data)
        if offset != item["size"] or digest.hexdigest() != item["sha256"]:
            raise ValueError("File checksum mismatch")
        total += offset
    if total != release["totalSize"]:
        raise ValueError("Release size mismatch")


def assemble(work: Path, public_key: str, private_key: Path, version: str) -> None:
    """Build a self-contained media folder from the immutable snapshot."""
    profile = work / "media/edition"
    definition = json.loads((work / "definition.json").read_bytes())
    catalog = json.loads((profile / "catalog.json").read_bytes())
    for game in catalog["games"]:
        game_id = game["gameId"]
        release = verify_release((profile / f"release-{game_id}.json").read_bytes(), public_key, game_id)
        if tuple(map(int, release["minimumLauncherVersion"].split("."))) > tuple(map(int, version.split("."))):
            raise ValueError("Bundled game requires a newer launcher")
        materialize_game(release, work / "media/games" / game_id)
        for role in ("hero", "thumbnail"):
            (profile / f"{game_id}-{role}.png").write_bytes(download(game[f"{role}Url"], 16 * 1024 * 1024))
    definition["buildId"] = json.loads((work / "snapshot.json").read_bytes())["buildId"]
    definition["files"] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                           for path in sorted(profile.iterdir()) if path.is_file()}
    write_json(profile / "edition.json", definition)
    (profile / "edition.sig").write_text(sign_payload((profile / "edition.json").read_bytes(), private_key), encoding="ascii")


def package(work: Path, install_tree: Path, output: Path, version: str, ifw_root: Path | None) -> Path:
    """Create a hybrid installer with selectable games sourced from adjacent media."""
    definition = json.loads((work / "media/edition/edition.json").read_bytes())
    edition_id = definition["id"]
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,63}", edition_id):
        raise ValueError("Invalid edition ID")
    output.mkdir(parents=True, exist_ok=True)
    shutil.copytree(work / "media", output / "media")
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        packages = root / "packages"
        config_dir = root / "config"
        shutil.copytree(INSTALLER / "packages", packages)
        shutil.copytree(INSTALLER / "config", config_dir)
        shutil.copy2(ROOT / "assets/images/PandDLogo.png", config_dir / "PandDLogo.png")
        shutil.copytree(install_tree, packages / "org.pandd.launcher/data")
        config = config_dir / "config.xml"
        configure_metadata(config, packages / "org.pandd.launcher/meta/package.xml", version,
                           f"{ORIGIN}/v1/launcher/ifw/windows/x86_64")
        tree = ET.parse(config)
        for key in ("Name", "Title"):
            tree.getroot().find(key).text = definition["name"]
        tree.getroot().find("TargetDir").text = f"@HomeDir@/AppData/Local/PandD/Editions/{edition_id}"
        tree.getroot().find("RunProgram").text = "@TargetDir@/bin/PandD Game Launcher.exe"
        arguments = ET.SubElement(tree.getroot(), "RunProgramArguments")
        for argument in ("--edition", edition_id):
            ET.SubElement(arguments, "Argument").text = argument
        tree.write(config, encoding="utf-8", xml_declaration=True)
        script = (config_dir / "controlscript.qs").read_text(encoding="utf-8")
        script = script.replace('var launcherDirectoryName = "PandDGameLauncher";', f'var launcherDirectoryName = "{edition_id}";')
        script = script.replace('setDefaultPageVisible(QInstaller.ComponentSelection, false)', 'setDefaultPageVisible(QInstaller.ComponentSelection, true)')
        (config_dir / "controlscript.qs").write_text(script, encoding="utf-8")

        # Profile and edition shortcuts belong to a separate non-updated component
        meta = packages / "org.pandd.edition/meta"
        meta.mkdir(parents=True)
        shutil.copytree(work / "media/edition", packages / "org.pandd.edition/data/edition")
        xml = ET.Element("Package")
        for key, value in {"DisplayName": definition["name"], "Description": "配布版の固定情報とデザイン",
                           "Version": "1.0.0", "ReleaseDate": dt.date.today().isoformat(), "Default": "true", "ForcedInstallation": "true",
                           "Dependencies": "org.pandd.launcher", "Script": "installscript.qs"}.items():
            ET.SubElement(xml, key).text = value
        ET.ElementTree(xml).write(meta / "package.xml", encoding="utf-8", xml_declaration=True)
        (meta / "installscript.qs").write_text('''/** @brief 固定配布情報を導入する */
function Component() {}

/** @brief 配布版専用ショートカットを作成する */
Component.prototype.createOperations = function() {
    component.createOperations();
    component.addOperation("Mkdir", "@UserStartMenuProgramsPath@/PandD");
    component.addOperation("CreateShortcut", "@TargetDir@/bin/PandD Game Launcher.exe",
        "@UserStartMenuProgramsPath@/PandD/Edition-''' + edition_id + '''.lnk",
        "arguments=--edition ''' + edition_id + '''", "workingDirectory=@TargetDir@/bin",
        "description=" + ''' + json.dumps(definition["name"], ensure_ascii=True) + ''');
};
''', encoding="utf-8")

        # Game components invoke the launcher's importer; IFW never owns mutable game files
        catalog = json.loads((work / "media/edition/catalog.json").read_bytes())
        for game in catalog["games"]:
            game_id = game["gameId"]
            meta = packages / f"org.pandd.game.{game_id.replace('-', '_')}/meta"
            meta.mkdir(parents=True)
            xml = ET.Element("Package")
            for key, value in {"DisplayName": game["name"], "Description": game["summary"],
                               "Version": "1.0.0", "ReleaseDate": dt.date.today().isoformat(), "Default": "false", "Dependencies": "org.pandd.edition",
                               "Script": "installscript.qs"}.items():
                ET.SubElement(xml, key).text = value
            ET.ElementTree(xml).write(meta / "package.xml", encoding="utf-8", xml_declaration=True)
            (meta / "installscript.qs").write_text('''/** @brief 媒体上の選択ゲームを登録する */
function Component() {}

/** @brief 共通の検証・配置処理を同期実行する */
Component.prototype.createOperations = function() {
    component.createOperations();
    component.addOperation("Execute", "@TargetDir@/bin/PandD Game Launcher.exe",
        "--edition", "''' + edition_id + '''", "--install-media", installer.value("InstallerDirPath") + "/media",
        "--game", "''' + game_id + '''");
};
''', encoding="utf-8")
        installer = output / "Setup.exe"
        subprocess.run([executable(ifw_root, "binarycreator"), "--hybrid", "-c", config,
                        "-p", packages, installer], check=True)
    shutil.copy2(work / "snapshot.json", output / "build-info.json")
    (output / "README.txt").write_text(
        f'{definition["name"]}\n\nSetup.exe と media フォルダーを同じ場所に置いてください。\n'
        'Setup.exe を起動し、導入するゲームを選択します。インターネット接続は不要です。\n'
        '後から追加する場合はランチャーの「配布媒体からインストール」で media を選択します。\n', encoding="utf-8")
    return installer


def main() -> None:
    """Run one auditable phase of the physical edition build."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["freeze", "assemble", "package", "status"])
    parser.add_argument("--work", type=Path, default=Path("edition-work"))
    parser.add_argument("--install-tree", type=Path, default=Path("staging"))
    parser.add_argument("--output", type=Path, default=Path("physical-distribution"))
    parser.add_argument("--ifw-root", type=Path)
    parser.add_argument("--version")
    args = parser.parse_args()
    build_id = os.environ.get("EDITION_BUILD_ID", "")
    if args.phase == "freeze":
        try:
            freeze(args.work, os.environ["EDITION_ID"], build_id, os.environ["MANIFEST_PUBLIC_KEY_BASE64"])
        except Exception:
            # 認証とrun固定が済んでいる場合だけ失敗状態を記録できる
            try:
                control_plane_request("/api/actions/editions", {
                    "action": "status", "buildId": build_id, "state": "failed",
                    "error": "同梱リリースの確定に失敗しました。Actionsログを確認してください",
                })
            except Exception:
                pass
            raise
    elif args.phase == "assemble":
        with tempfile.TemporaryDirectory() as temporary:
            private = Path(temporary) / "key.pem"
            private.write_text(os.environ["MANIFEST_PRIVATE_KEY_PEM"], encoding="ascii")
            assemble(args.work, os.environ["MANIFEST_PUBLIC_KEY_BASE64"], private, args.version)
    elif args.phase == "package":
        package(args.work, args.install_tree, args.output, args.version, args.ifw_root)
    else:
        status = os.environ["EDITION_BUILD_STATUS"]
        payload = {"action": "status", "buildId": build_id,
                   "state": {"success": "succeeded", "failure": "failed"}.get(status, status)}
        if os.environ.get("EDITION_ARTIFACT_ID"):
            payload["artifactId"] = os.environ["EDITION_ARTIFACT_ID"]
        control_plane_request("/api/actions/editions", payload)


if __name__ == "__main__":
    main()
