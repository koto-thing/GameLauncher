import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// リクエスト経路で利用する依存クレート不要の Rust 検証モジュールをビルドする
const root = new URL("../", import.meta.url);
execFileSync("cargo", ["build", "--manifest-path", "rust-validation/Cargo.toml", "--target", "wasm32-unknown-unknown", "--release", "--locked"], {
  cwd: fileURLToPath(root), stdio: "inherit",
});
mkdirSync(new URL("src/generated/", root), { recursive: true });
copyFileSync(new URL("rust-validation/target/wasm32-unknown-unknown/release/analytics_validation.wasm", root), new URL("src/generated/analytics-validation.wasm", root));
