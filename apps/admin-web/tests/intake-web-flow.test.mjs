import assert from "node:assert/strict";
import test from "node:test";
import {
  validateDescriptorAndZip,
  verifyZipSha256,
  uploadArtifact,
  IntakeClientError,
  IntakeCancelledError,
} from "../lib/intake-client.ts";

const sampleDescriptor = {
  schemaVersion: 1,
  artifactId: "a1b2c3d4-e5f6-4a1b-8c2d-1234567890ab",
  artifactFile: "pixel-pile-1.0.0.zip",
  gameId: "pixel-pile",
  version: "1.0.0",
  platform: "windows",
  arch: "x86_64",
  sizeBytes: 12,
  fileCount: 2,
  sha256: "7509e5bda0c762d2bac7f90d758b5b2263fa01ccbc542ab5e3df163be08e6ca9", // sha256 of "hello world!"
  createdAt: "2026-08-15T00:00:00Z",
};

test("validateDescriptorAndZip succeeds on matching files", async () => {
  const file = new File([new TextEncoder().encode("hello world!")], "pixel-pile-1.0.0.zip");
  const result = await validateDescriptorAndZip(sampleDescriptor, file);
  assert.equal(result.descriptor.artifactId, sampleDescriptor.artifactId);
});

test("validateDescriptorAndZip rejects mismatched file name", async () => {
  const file = new File([new TextEncoder().encode("hello world!")], "other-game.zip");
  await assert.rejects(
    () => validateDescriptorAndZip(sampleDescriptor, file),
    (err) => err instanceof IntakeClientError && /ZIPファイル名/.test(err.message),
  );
});

test("validateDescriptorAndZip rejects mismatched file size", async () => {
  const file = new File([new TextEncoder().encode("wrong size content")], "pixel-pile-1.0.0.zip");
  await assert.rejects(
    () => validateDescriptorAndZip(sampleDescriptor, file),
    (err) => err instanceof IntakeClientError && /ZIPファイルの容量/.test(err.message),
  );
});

test("validateDescriptorAndZip rejects invalid descriptor schema", async () => {
  const file = new File([new TextEncoder().encode("hello world!")], "pixel-pile-1.0.0.zip");
  await assert.rejects(
    () => validateDescriptorAndZip({ ...sampleDescriptor, schemaVersion: 99 }, file),
    (err) => err instanceof IntakeClientError && /descriptorの形式が不正です/.test(err.message),
  );
});

test("verifyZipSha256 verifies accurate file hash", async () => {
  const file = new File([new TextEncoder().encode("hello world!")], "pixel-pile-1.0.0.zip");
  const hash = await verifyZipSha256(sampleDescriptor, file);
  assert.equal(hash, sampleDescriptor.sha256);
});

test("verifyZipSha256 detects hash mismatch", async () => {
  const file = new File([new TextEncoder().encode("hello world?")], "pixel-pile-1.0.0.zip");
  await assert.rejects(
    () => verifyZipSha256(sampleDescriptor, file),
    (err) => err instanceof IntakeClientError && /SHA-256ハッシュが一致しません/.test(err.message),
  );
});

test("uploadArtifact fails when unauthenticated (401)", async () => {
  const content = new TextEncoder().encode("hello world!");
  const file = new File([content], "pixel-pile-1.0.0.zip");

  const isolatedFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "/api/intake/uploads" && init?.method === "POST") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  };

  await assert.rejects(
    () => uploadArtifact(sampleDescriptor, file, { fetch: isolatedFetch }),
    (err) => err instanceof IntakeClientError && err.status === 401 && /ログインが必要です/.test(err.message),
  );
});

test("uploadArtifact fails when forbidden (403)", async () => {
  const content = new TextEncoder().encode("hello world!");
  const file = new File([content], "pixel-pile-1.0.0.zip");

  const isolatedFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "/api/intake/uploads" && init?.method === "POST") {
      return new Response(JSON.stringify({ error: "アップロード権限がありません" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  };

  await assert.rejects(
    () => uploadArtifact(sampleDescriptor, file, { fetch: isolatedFetch }),
    (err) => err instanceof IntakeClientError && err.status === 403 && /アップロード権限がありません/.test(err.message),
  );
});

test("uploadArtifact fails when session creation fails (400 conflict / validation)", async () => {
  const content = new TextEncoder().encode("hello world!");
  const file = new File([content], "pixel-pile-1.0.0.zip");

  const isolatedFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "/api/intake/uploads" && init?.method === "POST") {
      return new Response(JSON.stringify({ error: "このartifactはすでにseal済みです" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  };

  await assert.rejects(
    () => uploadArtifact(sampleDescriptor, file, { fetch: isolatedFetch }),
    (err) => err instanceof IntakeClientError && /すでにseal済みです/.test(err.message),
  );
});

test("uploadArtifact fails when part upload exhausts all retries", async () => {
  const content = new TextEncoder().encode("hello world!");
  const file = new File([content], "pixel-pile-1.0.0.zip");

  const isolatedFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "/api/intake/uploads" && init?.method === "POST") {
      return Response.json({
        artifactId: sampleDescriptor.artifactId,
        partSize: 10485760,
        partCount: 1,
        state: "uploading",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        uploadedParts: [],
      });
    }
    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}/parts`) && init?.method === "POST") {
      return Response.json({
        transport: "direct-r2",
        expiresIn: 900,
        parts: [{ partNumber: 1, url: "https://r2.test/part1" }],
      });
    }
    if (url === "https://r2.test/part1" && init?.method === "PUT") {
      return new Response(JSON.stringify({ error: "R2 connection reset" }), { status: 502 });
    }
    return new Response("Not found", { status: 404 });
  };

  await assert.rejects(
    () => uploadArtifact(sampleDescriptor, file, { fetch: isolatedFetch, maxConcurrency: 1 }),
    (err) => err instanceof IntakeClientError && /part 1 のuploadに失敗しました/.test(err.message),
  );
});

test("uploadArtifact succeeds after transient part upload retry", async () => {
  const content = new TextEncoder().encode("hello world!");
  const file = new File([content], "pixel-pile-1.0.0.zip");

  let partAttempts = 0;
  let sealed = false;

  const isolatedFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;

    if (url === "/api/intake/uploads" && init?.method === "POST") {
      return Response.json({
        artifactId: sampleDescriptor.artifactId,
        partSize: 10485760,
        partCount: 1,
        state: "uploading",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        uploadedParts: [],
      });
    }

    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}/parts`) && init?.method === "POST") {
      const body = JSON.parse(init.body);
      if (body.partNumbers) {
        return Response.json({
          transport: "direct-r2",
          expiresIn: 900,
          parts: [{ partNumber: 1, url: "https://r2.test/part1" }],
        });
      }
      if (body.completed) {
        assert.equal(body.completed.partNumber, 1);
        assert.equal(body.completed.etag, "mock-etag-1");
        return Response.json({ ok: true });
      }
    }

    if (url === "https://r2.test/part1" && init?.method === "PUT") {
      partAttempts += 1;
      if (partAttempts === 1) {
        throw new Error("Temporary network glitch");
      }
      return new Response(null, {
        status: 200,
        headers: { etag: '"mock-etag-1"' },
      });
    }

    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}/seal`) && init?.method === "POST") {
      sealed = true;
      return Response.json({
        artifactId: sampleDescriptor.artifactId,
        state: "sealed",
      });
    }

    return new Response("Not found", { status: 404 });
  };

  const result = await uploadArtifact(sampleDescriptor, file, { fetch: isolatedFetch, maxConcurrency: 1 });
  assert.equal(result.artifactId, sampleDescriptor.artifactId);
  assert.equal(result.state, "sealed");
  assert.equal(partAttempts, 2, "Should have retried part upload once");
  assert.equal(sealed, true);
});

test("uploadArtifact aborts and calls delete on cancellation", async () => {
  const content = new TextEncoder().encode("hello world!");
  const file = new File([content], "pixel-pile-1.0.0.zip");
  const abortController = new AbortController();

  let uploadDeleted = false;

  const isolatedFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;

    if (url === "/api/intake/uploads" && init?.method === "POST") {
      abortController.abort();
      return Response.json({
        artifactId: sampleDescriptor.artifactId,
        partSize: 10485760,
        partCount: 2,
        state: "uploading",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        uploadedParts: [],
      });
    }

    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}`) && init?.method === "DELETE") {
      uploadDeleted = true;
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  };

  await assert.rejects(
    () => uploadArtifact(sampleDescriptor, file, { signal: abortController.signal, fetch: isolatedFetch }),
    (err) => err instanceof IntakeCancelledError,
  );
  assert.equal(uploadDeleted, true, "Should have cleaned up session via DELETE");
});

test("uploadArtifact cleans up session via DELETE when in-progress PUT is aborted", async () => {
  const content = new TextEncoder().encode("hello world!");
  const file = new File([content], "pixel-pile-1.0.0.zip");
  const abortController = new AbortController();

  let uploadDeleted = false;
  let putAborted = false;

  const isolatedFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;

    if (url === "/api/intake/uploads" && init?.method === "POST") {
      return Response.json({
        artifactId: sampleDescriptor.artifactId,
        partSize: 10485760,
        partCount: 1,
        state: "uploading",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        uploadedParts: [],
      });
    }

    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}/parts`) && init?.method === "POST") {
      return Response.json({
        transport: "direct-r2",
        expiresIn: 900,
        parts: [{ partNumber: 1, url: "https://r2.test/part1" }],
      });
    }

    if (url === "https://r2.test/part1" && init?.method === "PUT") {
      putAborted = true;
      abortController.abort();
      throw new DOMException("The operation was aborted", "AbortError");
    }

    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}`) && init?.method === "DELETE") {
      uploadDeleted = true;
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  };

  await assert.rejects(
    () => uploadArtifact(sampleDescriptor, file, { signal: abortController.signal, fetch: isolatedFetch }),
    (err) => err instanceof IntakeCancelledError,
  );
  assert.equal(putAborted, true, "PUT request should have been initiated and aborted");
  assert.equal(uploadDeleted, true, "Should have cleaned up session via DELETE when PUT fetch is aborted");
});

test("uploadArtifact fails when seal endpoint returns error", async () => {
  const content = new TextEncoder().encode("hello world!");
  const file = new File([content], "pixel-pile-1.0.0.zip");

  const isolatedFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;

    if (url === "/api/intake/uploads" && init?.method === "POST") {
      return Response.json({
        artifactId: sampleDescriptor.artifactId,
        partSize: 10485760,
        partCount: 1,
        state: "uploading",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        uploadedParts: [],
      });
    }

    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}/parts`) && init?.method === "POST") {
      const body = JSON.parse(init.body);
      if (body.partNumbers) {
        return Response.json({
          transport: "direct-r2",
          expiresIn: 900,
          parts: [{ partNumber: 1, url: "https://r2.test/part1" }],
        });
      }
      if (body.completed) {
        return Response.json({ ok: true });
      }
    }

    if (url === "https://r2.test/part1" && init?.method === "PUT") {
      return new Response(null, {
        status: 200,
        headers: { etag: '"mock-etag-1"' },
      });
    }

    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}/seal`) && init?.method === "POST") {
      return new Response(JSON.stringify({ error: "sealed objectの容量を検証できませんでした" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  };

  await assert.rejects(
    () => uploadArtifact(sampleDescriptor, file, { fetch: isolatedFetch }),
    (err) => err instanceof IntakeClientError && /容量を検証できませんでした/.test(err.message),
  );
});

test("uploadArtifact completes multi-part flow with worker-proxy transport", async () => {
  const content = new TextEncoder().encode("hello world! this is multi-part test content");
  const file = new File([content], "pixel-pile-1.0.0.zip");

  const uploadedParts = [];
  let sealed = false;

  const isolatedFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;

    if (url === "/api/intake/uploads" && init?.method === "POST") {
      return Response.json({
        artifactId: sampleDescriptor.artifactId,
        partSize: 20,
        partCount: 3,
        state: "uploading",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        uploadedParts: [],
      });
    }

    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}/parts`) && init?.method === "POST") {
      const body = JSON.parse(init.body);
      const parts = (body.partNumbers || []).map((partNumber) => ({
        partNumber,
        url: `http://localhost/api/intake/uploads/${sampleDescriptor.artifactId}/parts/${partNumber}`,
      }));
      return Response.json({
        transport: "worker-proxy",
        expiresIn: 900,
        parts,
      });
    }

    const partMatch = url.match(/\/parts\/(\d+)$/);
    if (partMatch && init?.method === "PUT") {
      const partNumber = Number(partMatch[1]);
      uploadedParts.push(partNumber);
      return Response.json({
        partNumber,
        etag: `"proxy-etag-${partNumber}"`,
      });
    }

    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}/seal`) && init?.method === "POST") {
      sealed = true;
      return Response.json({
        artifactId: sampleDescriptor.artifactId,
        state: "sealed",
      });
    }

    return new Response("Not found", { status: 404 });
  };

  const result = await uploadArtifact(sampleDescriptor, file, { fetch: isolatedFetch, maxConcurrency: 2 });
  assert.equal(result.artifactId, sampleDescriptor.artifactId);
  assert.equal(result.state, "sealed");
  assert.deepEqual(uploadedParts.sort(), [1, 2, 3]);
  assert.equal(sealed, true);
});

test("uploadArtifact completes multi-part flow with direct-r2 transport", async () => {
  const content = new TextEncoder().encode("hello world! this is direct-r2 multipart test content");
  const file = new File([content], "pixel-pile-1.0.0.zip");

  const completedParts = [];
  let sealed = false;

  const isolatedFetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;

    if (url === "/api/intake/uploads" && init?.method === "POST") {
      return Response.json({
        artifactId: sampleDescriptor.artifactId,
        partSize: 20,
        partCount: 3,
        state: "uploading",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        uploadedParts: [],
      });
    }

    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}/parts`) && init?.method === "POST") {
      const body = JSON.parse(init.body);
      if (body.partNumbers) {
        return Response.json({
          transport: "direct-r2",
          expiresIn: 900,
          parts: body.partNumbers.map((partNumber) => ({
            partNumber,
            url: `https://r2.direct.test/artifacts/${sampleDescriptor.artifactId}.zip?partNumber=${partNumber}`,
          })),
        });
      }
      if (body.completed) {
        completedParts.push(body.completed.partNumber);
        return Response.json({ ok: true });
      }
    }

    const r2Match = url.match(/partNumber=(\d+)/);
    if (r2Match && init?.method === "PUT") {
      const partNumber = Number(r2Match[1]);
      return new Response(null, {
        status: 200,
        headers: { etag: `"r2-etag-${partNumber}"` },
      });
    }

    if (url.includes(`/api/intake/uploads/${sampleDescriptor.artifactId}/seal`) && init?.method === "POST") {
      sealed = true;
      return Response.json({
        artifactId: sampleDescriptor.artifactId,
        state: "sealed",
      });
    }

    return new Response("Not found", { status: 404 });
  };

  const result = await uploadArtifact(sampleDescriptor, file, { fetch: isolatedFetch, maxConcurrency: 2 });
  assert.equal(result.artifactId, sampleDescriptor.artifactId);
  assert.equal(result.state, "sealed");
  assert.deepEqual(completedParts.sort(), [1, 2, 3]);
  assert.equal(sealed, true);
});
