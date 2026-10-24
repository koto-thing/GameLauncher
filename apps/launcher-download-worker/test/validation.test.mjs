import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

// 配布するWasmを既存JavaScriptの契約と比較する
const {instance: {exports: core}} = await WebAssembly.instantiate(await readFile(new URL("../generated/validation.wasm", import.meta.url)));
const encoder = new TextEncoder();
const original = data => data?.schemaVersion === 1 && typeof data.version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(data.version) && /^[a-f0-9]{64}$/.test(data.sha256) && Number.isSafeInteger(data.size) && data.size > 0;

test("shipped Rust validator agrees with the original pointer rules", () => {
  for (const version of ["0.0.0", "1.2.3", "999999999999999999999999.2.3", "", "01.2.3", "1.2", "1.2.3.4", "1.2.3\n", "1.2.3\r", "1.2.3-beta", "１.2.3", "../../bad"]) {
    for (const sha256 of ["a".repeat(64), "0123456789abcdef".repeat(4), "A".repeat(64), "a".repeat(63), "a".repeat(64) + "\n"]) {
      for (const size of [1, 3, Number.MAX_SAFE_INTEGER, 0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
        for (const schemaVersion of [1, 0, 2]) {
          const data = {version, sha256, size, schemaVersion};
          const v = encoder.encode(version), d = encoder.encode(sha256);
          const input = new Uint8Array(core.memory.buffer, core.input_ptr(), 8192);
          input.set(v); input.set(d, v.length);
          assert.equal(core.validate(v.length, d.length, schemaVersion, size) === 1, original(data), JSON.stringify(data));
        }
      }
    }
  }
});
