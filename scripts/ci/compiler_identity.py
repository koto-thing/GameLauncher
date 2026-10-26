"""Identify the installed compiler and SDK before restoring native dependencies"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def main() -> None:
    """Hash the real compiler and runner toolchain metadata into a cache namespace"""
    compiler = shutil.which("cl" if os.name == "nt" else "c++")
    if not compiler:
        raise RuntimeError("Native compiler is missing")

    identity = {
        "compiler": hashlib.sha256(Path(compiler).read_bytes()).hexdigest(),
        "image": os.environ.get("ImageVersion", ""),
        "msvc": os.environ.get("VCToolsVersion", ""),
        "windows_sdk": os.environ.get("WindowsSDKVersion", ""),
    }
    if os.name != "nt":
        identity["version"] = subprocess.check_output([compiler, "--version"]).decode()

    digest = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    print(json.dumps(identity, indent=2))
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"key={digest}\n")


if __name__ == "__main__":
    main()
