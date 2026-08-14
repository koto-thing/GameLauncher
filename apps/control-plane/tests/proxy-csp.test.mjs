import assert from "node:assert/strict";
import test from "node:test";
import { buildContentSecurityPolicy } from "../lib/csp.ts";

test("buildContentSecurityPolicy includes 'unsafe-eval' in development mode (explicit flag)", () => {
  const devCsp = buildContentSecurityPolicy(true);
  assert.ok(
    devCsp.includes("'unsafe-eval'"),
    "Development CSP must include 'unsafe-eval'",
  );
  assert.match(
    devCsp,
    /script-src 'self' 'unsafe-inline' 'unsafe-eval'/,
    "script-src must have 'self', 'unsafe-inline', and 'unsafe-eval' in development",
  );
  assert.match(devCsp, /default-src 'self'/);
  assert.match(devCsp, /base-uri 'self'/);
  assert.match(devCsp, /connect-src 'self'/);
  assert.match(devCsp, /font-src 'self'/);
  assert.match(devCsp, /form-action 'self' https:\/\/github\.com/);
  assert.match(devCsp, /frame-ancestors 'none'/);
  assert.match(devCsp, /img-src 'self' data: https:\/\/avatars\.githubusercontent\.com/);
  assert.match(devCsp, /object-src 'none'/);
  assert.match(devCsp, /style-src 'self' 'unsafe-inline'/);
});

test("buildContentSecurityPolicy absolutely excludes 'unsafe-eval' in production mode (explicit flag)", () => {
  const prodCsp = buildContentSecurityPolicy(false);
  assert.ok(
    !prodCsp.includes("unsafe-eval"),
    "Production CSP must NOT include 'unsafe-eval'",
  );
  assert.match(
    prodCsp,
    /script-src 'self' 'unsafe-inline'(?:;|$)/,
    "script-src must strictly be 'self' 'unsafe-inline' without eval in production",
  );
  assert.match(prodCsp, /default-src 'self'/);
  assert.match(prodCsp, /base-uri 'self'/);
  assert.match(prodCsp, /connect-src 'self'/);
  assert.match(prodCsp, /font-src 'self'/);
  assert.match(prodCsp, /form-action 'self' https:\/\/github\.com/);
  assert.match(prodCsp, /frame-ancestors 'none'/);
  assert.match(prodCsp, /img-src 'self' data: https:\/\/avatars\.githubusercontent\.com/);
  assert.match(prodCsp, /object-src 'none'/);
  assert.match(prodCsp, /style-src 'self' 'unsafe-inline'/);
});

test("buildContentSecurityPolicy respects NODE_ENV environment variable by default", () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    const prodCsp = buildContentSecurityPolicy();
    assert.ok(
      !prodCsp.includes("unsafe-eval"),
      "Production NODE_ENV must not include 'unsafe-eval'",
    );
    assert.match(prodCsp, /script-src 'self' 'unsafe-inline'(?:;|$)/);

    process.env.NODE_ENV = "development";
    const devCsp = buildContentSecurityPolicy();
    assert.ok(
      devCsp.includes("'unsafe-eval'"),
      "Development NODE_ENV must include 'unsafe-eval'",
    );
    assert.match(devCsp, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);

    process.env.NODE_ENV = "test";
    const testCsp = buildContentSecurityPolicy();
    assert.ok(
      !testCsp.includes("unsafe-eval"),
      "Test NODE_ENV must not include 'unsafe-eval'",
    );
    assert.match(testCsp, /script-src 'self' 'unsafe-inline'(?:;|$)/);

    delete process.env.NODE_ENV;
    const unsetCsp = buildContentSecurityPolicy();
    assert.ok(
      !unsetCsp.includes("unsafe-eval"),
      "Unset NODE_ENV must not include 'unsafe-eval'",
    );
    assert.match(unsetCsp, /script-src 'self' 'unsafe-inline'(?:;|$)/);
  } finally {
    if (originalEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalEnv;
    }
  }
});
