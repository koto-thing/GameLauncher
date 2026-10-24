import policyModule from "./generated/intake-policy.wasm?module";

// Worker のモジュール読み込み時に Rust のポリシーを初期化する
const policy = new WebAssembly.Instance(policyModule).exports as {
  valid_part_number(part: number, count: number): number;
  expected_part_size(part: number, count: number, size: number, partSize: number): number;
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

/** Rust でパート番号の範囲を確認する */
export function validPartNumber(part: number, count: number): boolean {
  return policy.valid_part_number(part, count) === 1;
}

/** Rust の倍精度演算で期待容量を取得する */
export function expectedUploadPartSize(part: number, count: number, size: number, partSize: number): number {
  return policy.expected_part_size(part, count, size, partSize);
}
