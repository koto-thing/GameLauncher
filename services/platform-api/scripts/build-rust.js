import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// リクエスト経路で利用するRust バッチ検証モジュールをビルドする
const root = new URL("../", import.meta.url);
execFileSync("cargo", ["build", "--manifest-path", "rust-validation/Cargo.toml", "--target", "wasm32-unknown-unknown", "--release", "--locked"], {
  cwd: fileURLToPath(root), stdio: "inherit",
});
// バージョンを固定した標準ツールで文字列受渡し用の安全なバインディングを生成する
execFileSync(process.env.WASM_BINDGEN ?? "wasm-bindgen", [
  "rust-validation/target/wasm32-unknown-unknown/release/analytics_validation.wasm",
  "--target", "web", "--out-dir", "src/generated/rust", "--out-name", "analytics_validation",
], { cwd: fileURLToPath(root), stdio: "inherit" });
