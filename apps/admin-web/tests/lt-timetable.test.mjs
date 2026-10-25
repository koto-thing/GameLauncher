import test from "node:test";
import assert from "node:assert/strict";
import { moveSchedule } from "../lib/lt/timetable.ts";

test("順序入替は項目の長さを維持し連続配置する", () => {
  const blocks = [{ id: "a", kind: "opening", startsAt: "2026-11-01T01:00:00.000Z", endsAt: "2026-11-01T01:05:00.000Z" }, { id: "b", kind: "talk", talkId: "t", startsAt: "2026-11-01T01:05:00.000Z", endsAt: "2026-11-01T01:15:00.000Z" }];
  const moved = moveSchedule(blocks, 1, -1);
  assert.equal(moved[0].id, "b");
  assert.equal(moved[0].startsAt, "2026-11-01T01:00:00.000Z");
  assert.equal(moved[0].endsAt, "2026-11-01T01:10:00.000Z");
  assert.equal(moved[1].endsAt, "2026-11-01T01:15:00.000Z");
  assert.equal(blocks[0].id, "a");
});
