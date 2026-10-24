import module from "../generated/validation.wasm";

const {exports: core} = new WebAssembly.Instance(module);
const encoder = new TextEncoder();

/**
 * ポインター項目をRustで同期検証する
 * @param {unknown} data JSONから読み取ったポインター
 * @returns {boolean} 契約を満たす場合はtrue
 */
export function validPointer(data) {
  // JSONの型を確認してWasmの数値変換による受理を防ぐ
  if (typeof data?.version !== "string" || typeof data?.sha256 !== "string" ||
      typeof data?.schemaVersion !== "number" || typeof data?.size !== "number") return false;
  // 入力バッファーに格納できるバイト数へ制限する
  const version = encoder.encode(data.version);
  const digest = encoder.encode(data.sha256);
  if (version.length + digest.length > 8192) return false;
  // awaitを挟まずコピーと検証を完了してリクエスト間の干渉を防ぐ
  const input = new Uint8Array(core.memory.buffer, core.input_ptr(), 8192);
  input.set(version);
  input.set(digest, version.length);
  return core.validate(version.length, digest.length, data.schemaVersion, data.size) === 1;
}
