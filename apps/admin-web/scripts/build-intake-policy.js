import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Cloudflare のモジュールローダーへ渡す Rust モジュールをビルドする
const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(new URL("../lib/generated/", import.meta.url), { recursive: true });
const result = spawnSync("rustc", ["--edition=2024", "--crate-type=cdylib", "--target=wasm32-unknown-unknown", "-C", "opt-level=z", "-C", "panic=abort", "rust/intake-policy.rs", "-o", "lib/generated/intake-policy.wasm"], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
