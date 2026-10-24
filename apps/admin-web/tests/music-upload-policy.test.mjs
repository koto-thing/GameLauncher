import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { exports: policy } = await WebAssembly.instantiate(readFileSync(new URL("../lib/generated/music-upload-policy.wasm", import.meta.url))).then(result => result.instance);
const encoder = new TextEncoder();

/** 既存 JavaScript の受付条件と実際の Wasm ABI を比較する */
test("Music upload admission preserves capacity precedence and format rules", () => {
  const digests = ["a".repeat(64), "0".repeat(64), "A".repeat(64), "a".repeat(63), "a".repeat(65), "あ".repeat(64), "a".repeat(64) + "\n", ""];
  const mimes = ["audio/mpeg", "audio/wav", "image/jpeg", "image/png", "image/webp", "audio/ogg", "Audio/mpeg", "audio/mpeg; charset=utf-8", "", "あ".repeat(100)];
  for (const bytes of [NaN, Infinity, -Infinity, -1, 0, 0.5, 1, 100, 101, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])
    for (const limit of [100, Number.MAX_SAFE_INTEGER])
      for (const audio of [false, true])
        for (const digest of digests)
          for (const mime of mimes) {
            const expected = !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > limit ? 1
              : /^[a-f0-9]{64}$/.test(digest) && (audio ? ["audio/mpeg", "audio/wav"] : ["image/jpeg", "image/png", "image/webp"]).includes(mime) ? 0 : 2;
            const d = encoder.encode(digest.slice(0, 65));
            const m = encoder.encode(mime.slice(0, 65));
            const input = new Uint8Array(policy.memory.buffer, policy.upload_input(), 128);
            input.set(d.subarray(0, 64));
            input.set(m.subarray(0, 64), 64);
            assert.equal(policy.validate_upload(bytes, limit, Number(audio), d.length, m.length), expected);
          }
});
