import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Cloudflare bindingだけ固定して署名付きCookieと管理操作の期限を確認する
test("sessions and management actions expire after three hours", async () => {
  const source = (await readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"))
    .replace('import { env } from "cloudflare:workers";', 'const env = { SESSION_SECRET: "test-session-secret-with-32-characters" };')
    .replace('import { ensureSchema, getD1 } from "@/db/initialize";', "");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
  const auth = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const originalNow = Date.now;
  const start = Date.parse("2026-09-30T00:00:00.000Z");
  let now = start;
  Date.now = () => now;

  try {
    const actor = { githubUserId: "1", login: "admin", avatarUrl: "", isAdmin: true, gameAccess: true, authenticatedAt: new Date(start).toISOString(), authSource: "github" };
    const cookie = await auth.createSessionCookie(actor, new Request("https://example.com"));
    assert.match(cookie, /Max-Age=10800; Secure$/);
    const request = new Request("https://example.com/api/control", { headers: { cookie: cookie.split(";")[0] } });

    now = start + 3 * 3600000 - 1;
    assert.deepEqual(await auth.requireRecentSession(request), actor);

    now += 1;
    assert.equal(await auth.readSession(request), null);
    await assert.rejects(auth.requireRecentSession(request), (error) => error.status === 401);
  } finally {
    Date.now = originalNow;
  }
});
