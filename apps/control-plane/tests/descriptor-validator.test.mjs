import assert from "node:assert/strict";
import test from "node:test";
import { validateDescriptorSchema } from "../lib/descriptor-validator.ts";

const validSample = {
  schemaVersion: 1,
  artifactId: "a1b2c3d4-e5f6-4a1b-8c2d-1234567890ab",
  artifactFile: "pixel-pile-1.0.0-a1b2c3d4.zip",
  gameId: "pixel-pile",
  version: "1.0.0",
  platform: "windows",
  arch: "x86_64",
  sizeBytes: 10485760,
  fileCount: 42,
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  createdAt: "2026-08-15T00:00:00Z",
};

test("validateDescriptorSchema accepts valid descriptor", () => {
  const result = validateDescriptorSchema(validSample);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.descriptor);
  assert.equal(result.descriptor.artifactId, validSample.artifactId);
});

test("validateDescriptorSchema rejects non-object inputs", () => {
  assert.equal(validateDescriptorSchema(null).valid, false);
  assert.equal(validateDescriptorSchema("invalid").valid, false);
  assert.equal(validateDescriptorSchema([]).valid, false);
});

test("validateDescriptorSchema validates schemaVersion", () => {
  const result = validateDescriptorSchema({ ...validSample, schemaVersion: 2 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /schemaVersion/);
});

test("validateDescriptorSchema validates artifactId format", () => {
  const invalidIds = ["not-a-uuid", "12345", "a1b2c3d4-e5f6-3a1b-8c2d-1234567890ab"]; // not v4
  for (const id of invalidIds) {
    const result = validateDescriptorSchema({ ...validSample, artifactId: id });
    assert.equal(result.valid, false, `Should reject ${id}`);
  }
});

test("validateDescriptorSchema validates artifactFile path safety", () => {
  const invalidFiles = [
    "path/to/archive.zip",
    "..\\archive.zip",
    "archive.tar.gz",
    "archive.exe",
    "",
    "a".repeat(181) + ".zip",
  ];
  for (const file of invalidFiles) {
    const result = validateDescriptorSchema({ ...validSample, artifactFile: file });
    assert.equal(result.valid, false, `Should reject ${file}`);
  }
});

test("validateDescriptorSchema validates gameId and version format", () => {
  assert.equal(validateDescriptorSchema({ ...validSample, gameId: "Invalid_Game" }).valid, false);
  assert.equal(validateDescriptorSchema({ ...validSample, gameId: "ab" }).valid, false); // <3 chars
  assert.equal(validateDescriptorSchema({ ...validSample, version: "v1.0" }).valid, false);
  assert.equal(validateDescriptorSchema({ ...validSample, version: "1.0" }).valid, false);
});

test("validateDescriptorSchema validates sizeBytes and fileCount boundaries", () => {
  assert.equal(validateDescriptorSchema({ ...validSample, sizeBytes: 0 }).valid, false);
  assert.equal(validateDescriptorSchema({ ...validSample, sizeBytes: -100 }).valid, false);
  assert.equal(validateDescriptorSchema({ ...validSample, sizeBytes: 5368709121 }).valid, false); // >5 GiB
  assert.equal(validateDescriptorSchema({ ...validSample, fileCount: 0 }).valid, false);
  assert.equal(validateDescriptorSchema({ ...validSample, fileCount: 50001 }).valid, false); // >50,000 files
  assert.equal(validateDescriptorSchema({ ...validSample, fileCount: 60000 }).valid, false);
});

test("validateDescriptorSchema validates sha256 hex string", () => {
  assert.equal(validateDescriptorSchema({ ...validSample, sha256: "not-a-hash" }).valid, false);
  assert.equal(validateDescriptorSchema({ ...validSample, sha256: "e3b0c442" }).valid, false); // too short
  assert.equal(validateDescriptorSchema({ ...validSample, sha256: "g".repeat(64) }).valid, false); // non-hex
});

test("validateDescriptorSchema rejects additionalProperties enforced by canonical schema", () => {
  const withExtra = { ...validSample, unknownProperty: "unexpected" };
  const result = validateDescriptorSchema(withExtra);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(";"), /未知のプロパティ/);
});

test("validateDescriptorSchema rejects omitted required properties from canonical schema", () => {
  const requiredKeys = [
    "schemaVersion",
    "artifactId",
    "artifactFile",
    "gameId",
    "version",
    "platform",
    "arch",
    "sizeBytes",
    "fileCount",
    "sha256",
    "createdAt",
  ];
  for (const key of requiredKeys) {
    const copy = { ...validSample };
    delete copy[key];
    const result = validateDescriptorSchema(copy);
    assert.equal(result.valid, false, `Omitting ${key} must fail validation`);
    assert.match(result.errors.join(";"), new RegExp(`${key}は必須です`));
  }
});

test("validateDescriptorSchema validates date-time format on createdAt", () => {
  for (const badDate of ["2026-08-15 00:00:00", "not-a-date", "2026/08/15", "12345"]) {
    const result = validateDescriptorSchema({ ...validSample, createdAt: badDate });
    assert.equal(result.valid, false, `Invalid date ${badDate} must fail validation`);
  }
});

test("validateDescriptorSchema enforces const platform and arch", () => {
  assert.equal(validateDescriptorSchema({ ...validSample, platform: "linux" }).valid, false);
  assert.equal(validateDescriptorSchema({ ...validSample, arch: "arm64" }).valid, false);
});

test("validateDescriptorSchema operates safely in eval/Function-restricted runtime", () => {
  const originalFunction = globalThis.Function;
  try {
    let functionCalled = false;
    const proxiedFunction = function () {
      functionCalled = true;
      throw new Error("Dynamic code generation (new Function) is disallowed");
    };
    proxiedFunction.prototype = originalFunction.prototype;
    globalThis.Function = proxiedFunction;

    const validResult = validateDescriptorSchema(validSample);
    assert.equal(validResult.valid, true);
    assert.equal(functionCalled, false);

    const invalidResult = validateDescriptorSchema({ ...validSample, schemaVersion: 99 });
    assert.equal(invalidResult.valid, false);
    assert.equal(functionCalled, false);
  } finally {
    globalThis.Function = originalFunction;
  }
});
