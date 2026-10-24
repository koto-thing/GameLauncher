import {execFileSync} from "node:child_process";
import {mkdirSync, copyFileSync, chmodSync} from "node:fs";
import {fileURLToPath} from "node:url";

// 共有ワークスペースを変更せず専用クレートをビルドする
const root = fileURLToPath(new URL("../", import.meta.url));
execFileSync("cargo", ["build", "--manifest-path", "rust/Cargo.toml", "--target", "wasm32-unknown-unknown", "--release", "--locked"], {cwd: root, stdio: "inherit"});

// Workerが読み込む生成物を所定の場所へ配置する
mkdirSync(new URL("../generated/", import.meta.url), {recursive: true});
copyFileSync(new URL("../rust/target/wasm32-unknown-unknown/release/launcher_download_validation.wasm", import.meta.url), new URL("../generated/validation.wasm", import.meta.url));

// Cargo出力の実行権限を持ち込まずGit管理下のモードへ正規化する
chmodSync(new URL("../generated/validation.wasm", import.meta.url), 0o644);
