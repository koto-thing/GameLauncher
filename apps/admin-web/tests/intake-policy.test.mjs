import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createAdminTestHarness } from "./helpers/admin-worker-harness.mjs";
import { INTAKE_PART_SIZE, PRESIGNED_URL_SECONDS } from "../lib/artifact-limits.ts";

const server = createAdminTestHarness();

before(() => server.listen());
after(() => server.close());

// 本番と同じ Worker で Rust の設定値と既存アップロード条件の一致を確認する
test("Rust intake config preserves the public upload contract", async () => {
  const response = await server.fetch("http://localhost/api/intake/config");
  assert.equal(response.status, 200);

  const config = await response.json();
  assert.equal(config.partSize, INTAKE_PART_SIZE);
  assert.equal(config.uploadUrlLifetimeSeconds, PRESIGNED_URL_SECONDS);
  assert.equal(config.localDevelopment, false);
  assert.equal(typeof config.githubClientId, "string");
  assert.deepEqual(Object.keys(config).sort(), ["githubClientId", "localDevelopment", "partSize", "uploadUrlLifetimeSeconds"]);
});
