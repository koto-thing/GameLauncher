"""公式ソースと審査済み lock 差分からローカル CLI を再現する"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import urllib.request


def verify(path, expected):
    """ファイルの SHA256 を確認する

    引数: path は対象ファイル、expected は期待する SHA256
    戻り値: なし
    エラー: 不一致の場合は RuntimeError
    """
    # 入力を検証してから展開とビルドへ進む
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise RuntimeError("checksum mismatch: " + path.name)


def main():
    """審査済み CLI を構築してパスを表示する

    引数: --target-dir はビルド出力先
    戻り値: なし
    エラー: checksum・patch・build・版確認の失敗で停止する
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-dir", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    evidence = root / "docs/evidence"
    review = json.loads((evidence / "analytics-cli-resolution.json").read_text(encoding="utf-8"))
    target = Path(args.target_dir).resolve()

    # 公式 archive の checksum と展開時のパス安全性を確認する
    with tempfile.TemporaryDirectory(prefix="analytics-reviewed-cli-") as temporary:
        directory = Path(temporary)
        archive = directory / "cli.crate"
        urllib.request.urlretrieve("https://static.crates.io/crates/wasm-bindgen-cli/wasm-bindgen-cli-0.2.129.crate", archive)
        verify(archive, review["sourceArchiveSha256"])

        with tarfile.open(archive) as package:
            package.extractall(directory, filter="data")

        source = directory / "wasm-bindgen-cli-0.2.129"
        lock = source / "Cargo.lock"
        verify(lock, review["upstreamLockSha256"])

        # Git の改行変換を避けて公開済み四依存だけの差分を適用する
        patch = (evidence / "wasm-bindgen-cli-0.2.129-lock.patch").read_text(encoding="utf-8").replace("\r\n", "\n")
        subprocess.run(["git", "-c", "core.autocrlf=false", "apply", "--unidiff-zero", "-"], input=patch.encode(), cwd=source, check=True)
        lock.write_bytes(lock.read_bytes().replace(b"\r\n", b"\n"))
        verify(lock, review["reviewedLockSha256"])

        # 依存を固定してビルドし、審査済み版だけを実行する
        subprocess.run(["cargo", "build", "--manifest-path", str(source / "Cargo.toml"), "--locked", "--release", "--bin", "wasm-bindgen", "--target-dir", str(target)], check=True)
        binary = target / "release" / ("wasm-bindgen.exe" if os.name == "nt" else "wasm-bindgen")
        version = subprocess.check_output([str(binary), "--version"], text=True).strip()

        if version != "wasm-bindgen 0.2.129":
            raise RuntimeError("unexpected CLI version")

        print(binary)


if __name__ == "__main__":
    main()
