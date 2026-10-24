import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

// 配布するWasmを既存JavaScriptの契約と比較する
const {instance: {exports: core}} = await WebAssembly.instantiate(await readFile(new URL("../generated/validation.wasm", import.meta.url)));
const encoder = new TextEncoder();

/**
 * 移行前のJavaScript検証結果を取得する
 * @param {object} data 比較対象のポインター
 * @returns {boolean} 既存契約を満たす場合はtrue
 */
const original = data => data?.schemaVersion === 1 && typeof data.version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(data.version) && /^[a-f0-9]{64}$/.test(data.sha256) && Number.isSafeInteger(data.size) && data.size > 0;

test("shipped Rust validator agrees with the original pointer rules", () => {
  // 境界値と不正値の組合せを実際のWasmへ渡す
  for (const version of ["0.0.0", "1.2.3", "999999999999999999999999.2.3", "", "01.2.3", "1.2", "1.2.3.4", "1.2.3\n", "1.2.3\r", "1.2.3-beta", "１.2.3", "../../bad"]) {
    for (const sha256 of ["a".repeat(64), "0123456789abcdef".repeat(4), "A".repeat(64), "a".repeat(63), "a".repeat(64) + "\n"]) {
      for (const size of [1, 3, Number.MAX_SAFE_INTEGER, 0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
        for (const schemaVersion of [1, 0, 2]) {
          const data = {version, sha256, size, schemaVersion};
          const v = encoder.encode(version), d = encoder.encode(sha256);
          const input = new Uint8Array(core.memory.buffer, core.input_ptr(), 8192);

          // コピー直後の結果を既存の検証式と比較する
          input.set(v); input.set(d, v.length);
          assert.equal(core.validate(v.length, d.length, schemaVersion, size) === 1, original(data), JSON.stringify(data));
        }
      }
    }
  }
});

test("Wasm ABI rejects boundary lengths and accepts a subsequent valid call", () => {
  // 空入力と上限付近の不正入力を例外なしで拒否する
  const input = new Uint8Array(core.memory.buffer, core.input_ptr(), 8192);
  input.fill(0);
  for (const [versionLength, digestLength] of [[0, 0], [8192, 0], [0, 8192], [8193, 0], [0, 8193], [8192, 1], [0xffffffff, 0], [0, 0xffffffff], [0xffffffff, 0xffffffff]]) {
    assert.equal(core.validate(versionLength, digestLength, 1, 3), 0);
  }

  // 容量ちょうどの有効入力を受理して境界内の読取りを確認する
  const boundaryVersion = encoder.encode("1".repeat(8124) + ".0.0");
  const digest = encoder.encode("a".repeat(64));
  assert.equal(boundaryVersion.length + digest.length, 8192);
  input.set(boundaryVersion);
  input.set(digest, boundaryVersion.length);
  assert.equal(core.validate(boundaryVersion.length, digest.length, 1, 3), 1);

  // 境界超過を拒否した直後も短い有効入力を再利用できる
  assert.equal(core.validate(8193, 64, 1, 3), 0);
  const version = encoder.encode("1.2.3");
  input.set(version);
  input.set(digest, version.length);
  assert.equal(core.validate(version.length, digest.length, 1, 3), 1);
});
