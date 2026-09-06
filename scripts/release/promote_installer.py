"""Promote the Windows download pointer only after verified production publication."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ORIGIN = "https://downloads.koto-thing.com"
POINTER = "v1/launcher/downloads/windows/x86_64/latest.json"
USER_AGENT = "PandD-GameLauncher-Release/1.0 (+https://github.com/koto-thing/GameLauncher)"


def version_tuple(version):
    if not isinstance(version, str) or not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Invalid release version")
    return tuple(map(int, version.split(".")))


def aws(endpoint, *args):
    return subprocess.run(["aws", *args, "--endpoint-url", endpoint], check=True, capture_output=True, text=True).stdout


def current_pointer(endpoint, bucket):
    # A failed request is an error, never permission to replace an unknown pointer.
    listing = json.loads(aws(endpoint, "s3api", "list-objects-v2", "--bucket", bucket, "--prefix", POINTER, "--output", "json"))
    if not any(item["Key"] == POINTER for item in listing.get("Contents", [])):
        return None
    return json.loads(aws(endpoint, "s3", "cp", f"s3://{bucket}/{POINTER}", "-", "--no-progress"))


def guard(version, current):
    requested = version_tuple(version)
    if current is not None and requested < version_tuple(current["version"]):
        raise ValueError("Refusing to downgrade the published installer")


def verify_public(version, artifact):
    version_tuple(version)
    with artifact.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    sidecar = artifact.with_name(artifact.name + ".sha256").read_text().split()
    if sidecar != [digest, artifact.name]:
        raise ValueError("Installer SHA-256 sidecar mismatch")
    key = f"v1/launcher/installers/windows/x86_64/{version}/PandD-Game-Launcher-Online-Installer.exe"
    actual = hashlib.sha256()
    size = 0
    headers = {"Cache-Control": "no-cache", "User-Agent": USER_AGENT}
    with urlopen(Request(f"{ORIGIN}/{key}", headers=headers), timeout=120) as response:
        if response.geturl() != f"{ORIGIN}/{key}":
            raise ValueError("Unexpected installer redirect")
        while chunk := response.read(1024 * 1024):
            actual.update(chunk)
            size += len(chunk)
    if size != artifact.stat().st_size or actual.hexdigest() != digest:
        raise ValueError("Public installer differs from verified build")
    with urlopen(Request(f"{ORIGIN}/v1/launcher/ifw/windows/x86_64/Updates.xml", headers=headers), timeout=30) as response:
        xml = response.read(1024 * 1024 + 1)
    if len(xml) > 1024 * 1024:
        raise ValueError("IFW index too large")
    packages = ET.fromstring(xml).findall("PackageUpdate")
    if not any(p.findtext("Name") == "org.pandd.launcher" and p.findtext("Version") == version for p in packages):
        raise ValueError("Public IFW repository is not the requested version")
    return {"schemaVersion": 1, "version": version, "sha256": digest, "size": size}


def promote(version, artifact, endpoint, bucket):
    guard(version, current_pointer(endpoint, bucket))
    document = verify_public(version, artifact)
    # Release workflow serializes this entire publication job. No pointer writes precede verification.
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "latest.json"
        path.write_text(json.dumps(document) + "\n", encoding="utf-8")
        aws(endpoint, "s3", "cp", str(path), f"s3://{bucket}/{POINTER}", "--content-type", "application/json", "--cache-control", "no-store")
    if current_pointer(endpoint, bucket) != document:
        raise RuntimeError("Pointer read-back mismatch")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    if args.check_only:
        guard(args.version, current_pointer(args.endpoint, args.bucket))
    elif args.artifact is None:
        parser.error("--artifact is required for promotion")
    else:
        promote(args.version, args.artifact, args.endpoint, args.bucket)


if __name__ == "__main__":
    main()
