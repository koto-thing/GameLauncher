import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

test("VitePress configuration derives the Pages base path from the environment", async () => {
  const config = await readFile(resolve(root, "docs/.vitepress/config.mts"), "utf8");
  assert.match(config, /DOCS_BASE_PATH/);
  assert.doesNotMatch(config, /base:\s*["']\/GameLauncher\//);
});

test("OpenAPI specification is 3.1 and documents every implemented route", async () => {
  const spec = await readFile(resolve(root, "packages/contracts/openapi/admin-api.openapi.yaml"), "utf8");
  assert.match(spec, /^openapi: 3\.1\.0/m);
  const expected = [
    "/api/actions/preflight", "/api/actions/status", "/api/auth/dev",
    "/api/auth/github/callback", "/api/auth/github/start", "/api/auth/logout",
    "/api/control", "/api/dashboard", "/api/intake/config", "/api/intake/uploads",
    "/api/intake/uploads/{artifactId}", "/api/intake/uploads/{artifactId}/parts",
    "/api/intake/uploads/{artifactId}/parts/{partNumber}",
    "/api/intake/uploads/{artifactId}/seal",
  ];
  for (const route of expected) assert.match(spec, new RegExp(`^  ${route.replace(/[{}]/g, "\\$&")}:$`, "m"));
});

test("archive documents are excluded from public navigation", async () => {
  const config = await readFile(resolve(root, "docs/.vitepress/config.mts"), "utf8");
  for (const name of ["LUNA_IMPLEMENTATION_PLAN", "INTAKE_UPLOADER_PLAN", "NEXT_AGENT_DOCS_PORTAL_HANDOFF"])
    assert.doesNotMatch(config, new RegExp(name));
});
