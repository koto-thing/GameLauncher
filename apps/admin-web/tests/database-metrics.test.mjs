import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers/role-fixture.mjs";

// 診断有効時も既存の公開処理と同一トランザクションの監査を維持する
test("optional D1 metrics preserve publishing and its existing actor/time/payload audit", async (t) => {
  const logs = [];
  t.mock.method(console, "info", (line) => logs.push(JSON.parse(line)));
  const f = await fixture(t, { metrics: true });
  const { requestId } = await f.control.createRequest(f.actor, f.input);
  await f.preflight(requestId);
  assert.equal(f.state(requestId), "running");
  const events = f.sql.prepare("SELECT * FROM audit_events WHERE request_id=? ORDER BY sequence").all(requestId);
  assert.ok(events.length >= 3);
  assert.equal(events[0].event_type, "request_created");
  assert.equal(events[0].actor_github_user_id, f.actor.githubUserId);
  assert.ok(Number.isFinite(Date.parse(events[0].occurred_at)));
  for (let index = 1; index < events.length; index++) assert.equal(events[index].previous_event_hash, events[index - 1].event_hash);
  assert.ok(logs.some((log) => log.database === "deployment-control-plane" && log.operation === "batch"));
  assert.doesNotMatch(JSON.stringify(logs), /test-game|credential|SELECT|INSERT|operator|artifact/);

  // Logging is optional even when its sink fails
  t.mock.method(console, "info", () => { throw new Error("diagnostic sink unavailable"); });
  assert.equal(await f.roles.currentRole(f.actor.githubUserId), "assistant");
});
