import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildArtifact,
  createMetadata,
  validateDraft,
  validateArchivePath,
  normalizeBuildRelativePath,
  validateAndCollectBuildFiles,
  computeLaunchPaths,
  validateGameReleaseSourceSchema,
  ArtifactValidationError,
  ArtifactBuildCancelledError,
  Crc32,
  crc32Bytes,
  createDeterministicZip,
  deflateRawStreamToBlobParts,
} from "../lib/artifact-builder/index.ts";
import { uploadArtifact } from "../lib/intake-client.ts";

function createMockBuildFile(relativePath, content = "sample content", sizeOverride = undefined) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const name = relativePath.split("/").pop() || relativePath;
  const size = sizeOverride !== undefined ? sizeOverride : bytes.length;
  return {
    name,
    relativePath,
    size,
    slice: (start = 0, end = size) => new Blob([bytes.subarray(start, end)]),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function createMockImageFile(name, content = "fake image content") {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    size: bytes.length,
    slice: (start = 0, end = bytes.length) => new Blob([bytes.subarray(start, end)]),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function makeValidDraft(overrides = {}) {
  const buildFiles = [
    createMockBuildFile("bin/MyGame.exe", "MZ executable binary"),
    createMockBuildFile("bin/UnityPlayer.dll", "unity player dll"),
    createMockBuildFile("bin/MyGame_Data/globalgamemanagers", "game data"),
  ];

  return {
    gameId: "sample-game",
    version: "1.0.0",
    minimumLauncherVersion: "1.0.1",
    engine: "unity",
    saveDirectoryName: "SampleGame",
    translations: {
      "ja-JP": { name: "サンプルゲーム", summary: "日本語の概要です。" },
      "en-US": { name: "Sample Game", summary: "English summary here." },
    },
    hero: createMockImageFile("hero.png"),
    thumbnail: createMockImageFile("thumbnail.webp"),
    focalPoint: { x: 0.5, y: 0.5 },
    buildFiles,
    entrypointRelativePath: "bin/MyGame.exe",
    ...overrides,
  };
}

// -------------------------------------------------------------
// 1. Game metadata validation tests
// -------------------------------------------------------------

test("validateDraft accepts valid draft", () => {
  const draft = makeValidDraft();
  const preview = validateDraft(draft);
  assert.equal(preview.entrypoint, "bin/MyGame.exe");
  assert.equal(preview.workingDirectory, "bin");
  assert.equal(preview.files, 3);
  assert.deepEqual(preview.locales, ["en-US", "ja-JP"]);
});

test("validateDraft accepts root entrypoint with working directory '.'", () => {
  const draft = makeValidDraft({
    buildFiles: [
      createMockBuildFile("MyGame.exe", "MZ executable binary"),
      createMockBuildFile("Data/game.dat", "game data"),
    ],
    entrypointRelativePath: "MyGame.exe",
  });
  const preview = validateDraft(draft);
  assert.equal(preview.entrypoint, "MyGame.exe");
  assert.equal(preview.workingDirectory, ".");
});

test("validateDraft rejects invalid gameId", () => {
  for (const bad of ["GAME", "a", "ab", "-abc", "abc-", "game_id", "game.id"]) {
    const draft = makeValidDraft({ gameId: bad });
    assert.throws(
      () => validateDraft(draft),
      (err) => err instanceof ArtifactValidationError && /ゲームID/.test(err.message),
    );
  }
});

test("validateDraft rejects invalid semver", () => {
  for (const bad of ["1.0", "v1.0.0", "1.0.0.0", "01.0.0", "1.0.0-beta"]) {
    const draft = makeValidDraft({ version: bad });
    assert.throws(
      () => validateDraft(draft),
      (err) => err instanceof ArtifactValidationError && /バージョン/.test(err.message),
    );
  }
});

test("validateDraft rejects unsupported engine", () => {
  const draft = makeValidDraft({ engine: "unreal" });
  assert.throws(
    () => validateDraft(draft),
    (err) => err instanceof ArtifactValidationError && /ゲームエンジン/.test(err.message),
  );
});

test("validateDraft rejects missing ja-JP translation", () => {
  const draft = makeValidDraft({
    translations: {
      "en-US": { name: "Sample", summary: "Summary" },
    },
  });
  assert.throws(
    () => validateDraft(draft),
    (err) => err instanceof ArtifactValidationError && /日本語/.test(err.message),
  );
});

test("validateDraft rejects invalid locale tag", () => {
  const draft = makeValidDraft({
    translations: {
      "ja-JP": { name: "サンプル", summary: "説明" },
      "ja_JP": { name: "不正", summary: "アンダースコア" },
    },
  });
  assert.throws(
    () => validateDraft(draft),
    (err) => err instanceof ArtifactValidationError && /言語タグが不正/.test(err.message),
  );
});

test("validateDraft rejects invalid saveDirectoryName", () => {
  for (const bad of ["A", "a/b", "save.dir", "save dir", ""]) {
    const draft = makeValidDraft({ saveDirectoryName: bad });
    assert.throws(
      () => validateDraft(draft),
      (err) => err instanceof ArtifactValidationError && /セーブディレクトリ名/.test(err.message),
    );
  }
});

test("validateDraft rejects invalid focal point coordinates", () => {
  for (const bad of [{ x: -0.1, y: 0.5 }, { x: 0.5, y: 1.1 }, { x: NaN, y: 0.5 }]) {
    const draft = makeValidDraft({ focalPoint: bad });
    assert.throws(
      () => validateDraft(draft),
      (err) => err instanceof ArtifactValidationError && /hero焦点位置/.test(err.message),
    );
  }
});

test("validateDraft rejects non-image hero or thumbnail", () => {
  const draft1 = makeValidDraft({ hero: createMockImageFile("hero.bmp") });
  assert.throws(
    () => validateDraft(draft1),
    (err) => err instanceof ArtifactValidationError && /hero画像/.test(err.message),
  );

  const draft2 = makeValidDraft({ thumbnail: createMockImageFile("thumb.gif") });
  assert.throws(
    () => validateDraft(draft2),
    (err) => err instanceof ArtifactValidationError && /thumbnail画像/.test(err.message),
  );
});

// -------------------------------------------------------------
// 2. Build files and path safety validation tests
// -------------------------------------------------------------

test("validateDraft rejects empty build files", () => {
  const draft = makeValidDraft({ buildFiles: [] });
  assert.throws(
    () => validateDraft(draft),
    (err) => err instanceof ArtifactValidationError && /ファイルがありません/.test(err.message),
  );
});

test("validateDraft rejects non-exe entrypoint or entrypoint outside build", () => {
  const draft1 = makeValidDraft({ entrypointRelativePath: "bin/game.dll" });
  assert.throws(
    () => validateDraft(draft1),
    (err) => err instanceof ArtifactValidationError && /Windowsの起動exe/.test(err.message),
  );

  const draft2 = makeValidDraft({ entrypointRelativePath: "other/NonExistent.exe" });
  assert.throws(
    () => validateDraft(draft2),
    (err) => err instanceof ArtifactValidationError && /ビルドフォルダ内から選択/.test(err.message),
  );
});

test("validateAndCollectBuildFiles rejects 0-byte empty file", () => {
  const files = [
    createMockBuildFile("game.exe", "content"),
    createMockBuildFile("empty.dat", new Uint8Array(0)),
  ];
  assert.throws(
    () => validateAndCollectBuildFiles(files),
    (err) => err instanceof ArtifactValidationError && /空ファイルはartifactに含められません/.test(err.message),
  );
});

test("validateAndCollectBuildFiles rejects Windows reserved file names", () => {
  for (const reserved of ["CON.txt", "prn.dat", "aux.bin", "nul.json", "COM1.exe", "LPT9.dll"]) {
    const files = [createMockBuildFile(reserved, "content")];
    assert.throws(
      () => validateAndCollectBuildFiles(files),
      (err) => err instanceof ArtifactValidationError && /Windows予約名/.test(err.message),
    );
  }
});

test("validateAndCollectBuildFiles rejects case-insensitive path collisions", () => {
  const files = [
    createMockBuildFile("Data/File.txt", "data 1"),
    createMockBuildFile("data/file.txt", "data 2"),
  ];
  assert.throws(
    () => validateAndCollectBuildFiles(files),
    (err) => err instanceof ArtifactValidationError && /大文字小文字だけが異なるパス/.test(err.message),
  );
});

test("validateAndCollectBuildFiles rejects more than 50,000 files", () => {
  // Generate 50,001 entries
  const files = Array.from({ length: 50001 }, (_, i) =>
    createMockBuildFile(`file_${i}.dat`, "x"),
  );
  assert.throws(
    () => validateAndCollectBuildFiles(files),
    (err) => err instanceof ArtifactValidationError && /50,000件まで/.test(err.message),
  );
});

test("validateAndCollectBuildFiles rejects total source size exceeding 5 GiB", () => {
  // 5 GiB + 1 byte (5368709121 bytes)
  const files = [
    createMockBuildFile("large.bin", "dummy", 5368709121),
  ];
  assert.throws(
    () => validateAndCollectBuildFiles(files),
    (err) => err instanceof ArtifactValidationError && /5 GiB以下/.test(err.message),
  );
});

test("validateArchivePath rejects paths exceeding 240 chars", () => {
  const longName = "a".repeat(241);
  assert.throws(
    () => validateArchivePath(`build/${longName}`),
    (err) => err instanceof ArtifactValidationError && /240文字/.test(err.message),
  );
});

test("validateArchivePath rejects leading backslash, UNC, drive-qualified, traversal, trailing space/dot, and NUL", () => {
  const invalidPaths = [
    "\\build\\game.exe", // leading backslash
    "\\\\server\\share\\game.exe", // UNC path
    "C:\\build\\game.exe", // drive-qualified
    "c:/build/game.exe", // drive-qualified posix
    "build\\game.exe", // contains backslash
    "build/game.exe ", // trailing space
    "build/game.exe.", // trailing dot
    "build/folder./game.exe", // trailing dot on segment
    "build/folder /game.exe", // trailing space on segment
    "build/game\0.exe", // NUL control char
    "build/game\x1f.exe", // control char
    "build/game<>.exe", // forbidden windows chars
    "../outside.txt", // traversal
    "/absolute/path.txt", // leading slash
    "unknown/path.txt", // not build/ or metadata/
  ];

  for (const badPath of invalidPaths) {
    assert.throws(
      () => validateArchivePath(badPath),
      (err) => err instanceof ArtifactValidationError,
      `Should reject archive path: ${badPath}`,
    );
  }
});

test("normalizeBuildRelativePath rejects leading backslash, UNC, drive-qualified, trailing dot/space, and NUL", () => {
  const invalidRelative = [
    "\\bin\\game.exe",
    "\\\\unc\\share\\game.exe",
    "C:\\game.exe",
    "c:/game.exe",
    "/bin/game.exe",
    "bin/game.exe ",
    "bin/game.exe.",
    "bin /game.exe",
    "bin./game.exe",
    "bin/game\0.exe",
    "bin/game\r.exe",
    "bin/game:stream.exe",
    "../game.exe",
    "",
  ];

  for (const bad of invalidRelative) {
    assert.throws(
      () => normalizeBuildRelativePath(bad),
      (err) => err instanceof ArtifactValidationError,
      `Should reject relative build path: ${bad}`,
    );
  }

  // Valid relative paths normalize backslashes to posix slashes
  assert.equal(normalizeBuildRelativePath("bin\\game.exe"), "bin/game.exe");
  assert.equal(normalizeBuildRelativePath("game.exe"), "game.exe");
});

test("computeLaunchPaths rejects leading backslash, UNC, drive-qualified, and control characters", () => {
  for (const bad of ["\\bin\\game.exe", "\\\\server\\game.exe", "C:\\game.exe", "game.exe ", "game\0.exe"]) {
    assert.throws(
      () => computeLaunchPaths(bad),
      (err) => err instanceof ArtifactValidationError,
      `computeLaunchPaths should reject ${bad}`,
    );
  }
});

// -------------------------------------------------------------
// 3. Metadata generation and schema validation tests
// -------------------------------------------------------------

test("createMetadata generates valid release.json matching contracts schema", () => {
  const draft = makeValidDraft();
  const meta = createMetadata(draft, undefined, "2026-08-15T00:00:00Z");

  assert.equal(meta.document.gameId, "sample-game");
  assert.equal(meta.document.version, "1.0.0");
  assert.equal(meta.document.engine, "unity");
  assert.equal(meta.document.entrypoint, "bin/MyGame.exe");
  assert.equal(meta.document.workingDirectory, "bin");
  assert.equal(meta.document.hero, "hero.png");
  assert.equal(meta.document.thumbnail, "thumbnail.webp");
  assert.equal(meta.document.publishedAt, "2026-08-15T00:00:00Z");
  assert.deepEqual(meta.document.heroFocalPoint, { x: 0.5, y: 0.5 });
  assert.equal(meta.document.display["ja-JP"].name, "サンプルゲーム");

  // Validate against packages/contracts/schemas/game-release-source.schema.json
  const schemaPath = path.resolve(import.meta.dirname, "../../../packages/contracts/schemas/game-release-source.schema.json");
  assert.ok(fs.existsSync(schemaPath), "packages/contracts/schemas/game-release-source.schema.json must exist");
  const schemaJson = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

  // Check required fields match
  for (const req of schemaJson.required) {
    assert.ok(req in meta.document, `release.json must contain required field ${req}`);
  }

  const validation = validateGameReleaseSourceSchema(meta.document);
  assert.equal(validation.valid, true, `Validation errors: ${validation.errors.join(", ")}`);
});

test("validateGameReleaseSourceSchema enforces additionalProperties, required, pattern, and format via canonical schema", () => {
  const validDoc = {
    gameId: "valid-game",
    version: "1.0.0",
    minimumLauncherVersion: "1.0.0",
    publishedAt: "2026-08-15T00:00:00Z",
    engine: "unity",
    entrypoint: "bin/game.exe",
    workingDirectory: "bin",
    saveDirectoryName: "ValidGame",
    display: {
      "ja-JP": { name: "ゲーム", summary: "説明" },
    },
    hero: "hero.png",
    heroFocalPoint: { x: 0.5, y: 0.5 },
    thumbnail: "thumbnail.png",
  };

  // 1. additionalProperties: false
  const withExtra = { ...validDoc, unexpectedKey: "bad" };
  const extraRes = validateGameReleaseSourceSchema(withExtra);
  assert.equal(extraRes.valid, false);
  assert.match(extraRes.errors.join(";"), /未知のプロパティ/);

  // 2. required fields
  for (const key of Object.keys(validDoc)) {
    const copy = { ...validDoc };
    delete copy[key];
    const reqRes = validateGameReleaseSourceSchema(copy);
    assert.equal(reqRes.valid, false, `Omitting ${key} must fail validation`);
  }

  // 3. pattern enforcement
  assert.equal(validateGameReleaseSourceSchema({ ...validDoc, gameId: "Invalid_ID" }).valid, false);
  assert.equal(validateGameReleaseSourceSchema({ ...validDoc, version: "v1.0" }).valid, false);
  assert.equal(validateGameReleaseSourceSchema({ ...validDoc, entrypoint: "../bad.exe" }).valid, false);
  assert.equal(validateGameReleaseSourceSchema({ ...validDoc, entrypoint: "bad\\path.exe" }).valid, false);
  assert.equal(validateGameReleaseSourceSchema({ ...validDoc, hero: "/absolute/hero.png" }).valid, false);

  // 4. format enforcement (date-time)
  assert.equal(validateGameReleaseSourceSchema({ ...validDoc, publishedAt: "not-a-date" }).valid, false);
  assert.equal(validateGameReleaseSourceSchema({ ...validDoc, publishedAt: "2026-08-15 00:00:00" }).valid, false);

  // 5. enum enforcement
  assert.equal(validateGameReleaseSourceSchema({ ...validDoc, engine: "unreal" }).valid, false);

  // 6. focal point boundaries
  assert.equal(validateGameReleaseSourceSchema({ ...validDoc, heroFocalPoint: { x: -0.1, y: 0.5 } }).valid, false);
  assert.equal(validateGameReleaseSourceSchema({ ...validDoc, heroFocalPoint: { x: 0.5, y: 1.5 } }).valid, false);

  // 7. display minProperties & ja-JP required
  assert.equal(validateGameReleaseSourceSchema({ ...validDoc, display: {} }).valid, false);
  assert.equal(
    validateGameReleaseSourceSchema({
      ...validDoc,
      display: { "en-US": { name: "Name", summary: "Summary" } },
    }).valid,
    false,
  );
});

// -------------------------------------------------------------
// 4. CRC-32 & ZIP Builder tests
// -------------------------------------------------------------

test("CRC-32 matches standard test vectors", () => {
  const text = new TextEncoder().encode("123456789");
  const crc = crc32Bytes(text);
  assert.equal(crc, 0xcbf43926);
});

test("computeLaunchPaths correctly computes root and nested entrypoints", () => {
  const root = computeLaunchPaths("MyGame.exe");
  assert.equal(root.entrypoint, "MyGame.exe");
  assert.equal(root.workingDirectory, ".");

  const nested = computeLaunchPaths("bin/x64/MyGame.exe");
  assert.equal(nested.entrypoint, "bin/x64/MyGame.exe");
  assert.equal(nested.workingDirectory, "bin/x64");
});

test("Crc32 class matches incremental updates", () => {
  const hasher = new Crc32();
  hasher.update(new TextEncoder().encode("1234"));
  hasher.update(new TextEncoder().encode("56789"));
  assert.equal(hasher.digest(), 0xcbf43926);
});

test("deflateRawStreamToBlobParts streams chunks to Blob parts without raw Uint8Array accumulation", async () => {
  async function* generateChunks() {
    yield new TextEncoder().encode("hello ");
    yield new TextEncoder().encode("streaming ");
    yield new TextEncoder().encode("compression!");
  }

  const { compressedSize, blobParts } = await deflateRawStreamToBlobParts(generateChunks());
  assert.ok(compressedSize > 0);
  assert.ok(blobParts.length > 0);
  for (const part of blobParts) {
    assert.ok(part instanceof Blob, "Each compressed part must be backed by a Blob");
  }
});

test("createDeterministicZip builds valid ZIP with fixed date/time without retaining compressed body in entries", async () => {
  const entries = [
    {
      archivePath: "build/game.exe",
      size: 4,
      getData: async () => new TextEncoder().encode("test"),
    },
  ];

  const blob = await createDeterministicZip(entries);
  assert.ok(blob.size > 0);

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  assert.ok(bytes.length > 0);
  const view = new DataView(arrayBuffer);

  // Local file header signature 0x04034b50
  assert.equal(view.getUint32(0, true), 0x04034b50);
  // Last mod time = 0, Last mod date = 0x0021 (1980-01-01)
  assert.equal(view.getUint16(10, true), 0x0000);
  assert.equal(view.getUint16(12, true), 0x0021);
});

// -------------------------------------------------------------
// 5. Complete buildArtifact orchestrator tests
// -------------------------------------------------------------

test("buildArtifact produces valid artifact result and descriptor", async () => {
  const draft = makeValidDraft();
  const stages = [];

  const result = await buildArtifact(draft, {
    artifactIdOverride: "11111111-2222-4333-8444-555555555555",
    createdAtOverride: "2026-08-15T00:00:00Z",
    publishedAtOverride: "2026-08-15T00:00:00Z",
    onProgress: (p) => stages.push(p.stage),
  });

  assert.equal(result.artifactId, "11111111-2222-4333-8444-555555555555");
  assert.equal(result.artifactFile, "sample-game-1.0.0-11111111-2222-4333-8444-555555555555.zip");
  assert.equal(result.fileCount, 6); // 3 build files + 3 metadata files (release.json, hero.png, thumbnail.webp)
  assert.equal(result.sizeBytes, result.zipBlob.size);
  assert.equal(result.descriptor.sha256, result.sha256);
  assert.equal(result.descriptor.platform, "windows");
  assert.equal(result.descriptor.arch, "x86_64");

  // Validate descriptor against packages/contracts/schemas/deployment-artifact-descriptor.schema.json
  const schemaPath = path.resolve(
    import.meta.dirname,
    "../../../packages/contracts/schemas/deployment-artifact-descriptor.schema.json",
  );
  assert.ok(fs.existsSync(schemaPath));
  const schemaJson = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  for (const req of schemaJson.required) {
    assert.ok(req in result.descriptor, `descriptor must have ${req}`);
  }

  assert.ok(stages.includes("validating"));
  assert.ok(stages.includes("metadata"));
  assert.ok(stages.includes("zipping"));
  assert.ok(stages.includes("hashing"));
  assert.ok(stages.includes("completed"));
});

test("buildArtifact respects cancellation signal", async () => {
  const draft = makeValidDraft();
  const abortController = new AbortController();
  abortController.abort();

  await assert.rejects(
    () => buildArtifact(draft, { signal: abortController.signal }),
    (err) => err instanceof ArtifactBuildCancelledError,
  );
});

// -------------------------------------------------------------
// 6. Upload integration test with generated artifact
// -------------------------------------------------------------

test("uploadArtifact seamlessly accepts generated descriptor and zipBlob", async () => {
  const draft = makeValidDraft();
  const buildResult = await buildArtifact(draft, {
    artifactIdOverride: "22222222-3333-4444-8555-666666666666",
    createdAtOverride: "2026-08-15T00:00:00Z",
  });

  const zipFile = new File([buildResult.zipBlob], buildResult.artifactFile);
  let uploadCompleted = false;

  const mockFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;

    if (url === "/api/intake/uploads" && init?.method === "POST") {
      return Response.json({
        artifactId: buildResult.artifactId,
        partSize: 64 * 1024 * 1024,
        partCount: 1,
        state: "uploading",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        uploadedParts: [],
      });
    }

    if (url.includes(`/api/intake/uploads/${buildResult.artifactId}/parts`) && init?.method === "POST") {
      return Response.json({
        transport: "direct-r2",
        expiresIn: 900,
        parts: [{ partNumber: 1, url: "https://r2.test/part1" }],
      });
    }

    if (url === "https://r2.test/part1" && init?.method === "PUT") {
      return new Response(null, {
        status: 200,
        headers: { etag: '"test-etag-1"' },
      });
    }

    if (url.includes(`/api/intake/uploads/${buildResult.artifactId}/seal`) && init?.method === "POST") {
      uploadCompleted = true;
      return Response.json({
        artifactId: buildResult.artifactId,
        state: "sealed",
      });
    }

    return new Response("Not found", { status: 404 });
  };

  const uploadResult = await uploadArtifact(buildResult.descriptor, zipFile, {
    fetch: mockFetch,
    maxConcurrency: 1,
  });

  assert.equal(uploadResult.artifactId, buildResult.artifactId);
  assert.equal(uploadResult.state, "sealed");
  assert.equal(uploadCompleted, true);
});
