import module from "../../lib/generated/music-upload-policy.wasm?module";

const policy = new WebAssembly.Instance(module).exports as {
  memory: WebAssembly.Memory;
  upload_input(): number;
  validate_upload(bytes: number, limit: number, audio: number, digestLength: number, mimeLength: number): number;
};
const encoder = new TextEncoder();

/**
 * @brief 固定長 ABI で Rust のアップロード受付ルールを呼ぶ
 * @param bytes 申告容量
 * @param limit 用途別上限
 * @param audio 音声用途か
 * @param digest SHA256 表記
 * @param mime 申告形式
 * @returns 0 は許可、1 は容量違反、2 は形式違反
 */
export function uploadPolicy(bytes: number, limit: number, audio: boolean, digest: string, mime: string): number {
  // 長大な文字列をエンコードせず、Rust 側で形式違反として判定する
  const digestBytes = encoder.encode(digest.slice(0, 65));
  const mimeBytes = encoder.encode(mime.slice(0, 65));
  const input = new Uint8Array(policy.memory.buffer, policy.upload_input(), 128);
  input.set(digestBytes.subarray(0, 64));
  input.set(mimeBytes.subarray(0, 64), 64);

  return policy.validate_upload(bytes, limit, Number(audio), digestBytes.length, mimeBytes.length);
}
