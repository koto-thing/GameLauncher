import assert from "node:assert/strict";
import test from "node:test";
import { localEventTime, utcEventTime } from "../lib/lt/event-time.ts";

// 日本時間の開催日時と締切をUTCへ往復し、未編集の秒精度を保持する
test("event dates round trip in the selected zone", () => {
  assert.equal(localEventTime("2026-11-03T04:00:00.000Z", "Asia/Tokyo"), "2026-11-03T13:00");
  assert.equal(utcEventTime("2026-11-01T23:59", "Asia/Tokyo"), "2026-11-01T14:59:00.000Z");
  assert.equal(utcEventTime("2026-10-27T02:39", "Asia/Tokyo", "2026-10-26T17:39:24.208Z"), "2026-10-26T17:39:24.208Z");
  assert.equal(utcEventTime("2026-11-03T13:00", "UTC"), "2026-11-03T13:00:00.000Z");
});

// 夏時間の欠落・重複する時刻を黙って別の時刻へ変更しない
test("ambiguous and nonexistent local times are rejected", () => {
  assert.throws(() => utcEventTime("2026-03-08T02:30", "America/New_York"));
  assert.throws(() => utcEventTime("2026-11-01T01:30", "America/New_York"));
});
