import validationModule from "./generated/rust/analytics_validation_bg.wasm";
import { initSync } from "./generated/rust/analytics_validation.js";

// Workers の静的 Wasm モジュールを標準の生成済みバインディングで初期化する
initSync({ module: validationModule });

export { validate_batch, valid_timing, valid_outcome, valid_daily } from "./generated/rust/analytics_validation.js";
