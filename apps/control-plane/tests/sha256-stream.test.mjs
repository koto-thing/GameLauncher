import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { Sha256Hasher, hashFileInChunks } from "../lib/sha256-stream.ts";

function nodeSha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

test("Sha256Hasher matches standard test vectors", () => {
  // Empty string
  const h1 = new Sha256Hasher();
  assert.equal(h1.digest(), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

  // "abc"
  const h2 = new Sha256Hasher();
  h2.update(new TextEncoder().encode("abc"));
  assert.equal(h2.digest(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  // "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
  const msg3 = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
  const h3 = new Sha256Hasher();
  h3.update(new TextEncoder().encode(msg3));
  assert.equal(h3.digest(), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
});

test("Sha256Hasher matches node:crypto across various chunk splits", () => {
  const sizes = [1, 10, 55, 64, 65, 127, 128, 1000, 10000, 65536];

  for (const size of sizes) {
    const raw = randomBytes(size);
    const expected = nodeSha256(raw);

    // Single chunk
    const single = new Sha256Hasher();
    single.update(new Uint8Array(raw));
    assert.equal(single.digest(), expected, `Single chunk size ${size}`);

    // Split in random chunks
    const chunked = new Sha256Hasher();
    let offset = 0;
    while (offset < size) {
      const step = Math.min(size - offset, Math.floor(Math.random() * 13) + 1);
      chunked.update(new Uint8Array(raw.subarray(offset, offset + step)));
      offset += step;
    }
    assert.equal(chunked.digest(), expected, `Chunked size ${size}`);
  }
});

test("hashFileInChunks correctly hashes a Blob with progress callbacks", async () => {
  const raw = randomBytes(5 * 1024 * 1024 + 123); // ~5 MiB
  const expected = nodeSha256(raw);
  const blob = new Blob([raw]);

  let progressCalled = 0;
  const digest = await hashFileInChunks(blob, (processed, total) => {
    progressCalled += 1;
    assert.equal(total, raw.length);
    assert.ok(processed <= total);
  }, undefined, 1024 * 1024);

  assert.equal(digest, expected);
  assert.ok(progressCalled >= 5);
});
