import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.mjs";

test("same-host API preserves cookie/Origin/CSRF but drops forged actor and authorization", async () => {
  let called = false;
  const response = await worker.fetch(
    new Request("https://lt.example.invalid/api/lt/v1/applications", {
      method: "POST",
      headers: {
        cookie: "fixture=1",
        origin: "https://lt.example.invalid",
        "x-lt-csrf": "1",
        "content-type": "application/json",
        "x-role": "admin",
        authorization: "fixture",
      },
      body: "{}",
    }),
    {
      LT_PUBLIC: {
        async fetch(request) {
          called = true;
          assert.equal(request.headers.get("cookie"), "fixture=1");
          assert.equal(request.headers.get("origin"), "https://lt.example.invalid");
          assert.equal(request.headers.get("x-lt-csrf"), "1");
          assert.equal(request.headers.get("x-role"), null);
          assert.equal(request.headers.get("authorization"), null);
          assert.equal(await request.text(), "{}");
          return Response.json(
            { ok: true },
            { headers: { "Set-Cookie": "fixture=2; Secure; HttpOnly" } },
          );
        },
      },
    },
  );
  assert.equal(called, true);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
});
test("operator paths cannot reach internal Rust RPC and missing service fails closed", async () => {
  let calls = 0;
  const env = {
    LT_PUBLIC: {
      fetch() {
        calls++;
        throw Error("private detail");
      },
    },
  };
  assert.equal(
    (await worker.fetch(new Request("https://lt.example.invalid/api/lt/v1/operator/events"), env))
      .status,
    404,
  );
  assert.equal(calls, 0);
  const response = await worker.fetch(
    new Request("https://lt.example.invalid/api/lt/v1/events"),
    env,
  );
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("private detail"), false);
});
test("static fallback and typed disabled private API", async () => {
  const response = await worker.fetch(new Request("https://lt.example.invalid/events/fixture"), {
    ASSETS: { fetch: () => new Response("fixture asset") },
  });
  assert.equal(await response.text(), "fixture asset");
  const disabled = await worker.fetch(
    new Request("https://lt.example.invalid/api/lt/v1/auth/session"),
    { LT_PUBLIC: { fetch: () => new Response("upstream detail", { status: 501 }) } },
  );
  assert.equal((await disabled.json()).error.code, "NOT_IMPLEMENTED");
});
