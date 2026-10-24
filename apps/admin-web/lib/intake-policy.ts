import policyModule from "./generated/intake-policy.wasm?module";

// Worker のモジュール読み込み時に Rust のポリシーを初期化する
const policy = new WebAssembly.Instance(policyModule).exports as {
  intake_part_size(): number;
  presigned_url_seconds(): number;
};

/**
 * 設定 API のアップロード条件を Rust から取得する
 * @returns パートサイズと署名付き URL の有効期間
 */
export function intakePolicy() {
  return { partSize: policy.intake_part_size(), uploadUrlLifetimeSeconds: policy.presigned_url_seconds() };
}
