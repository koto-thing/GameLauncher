import test from "node:test";
import assert from "node:assert/strict";
import { scheduleDiff } from "../lib/lt/schedule-diff.ts";
import { actionItems } from "../lib/lt/action-items.ts";

test("時間割の差分は追加・削除・終了時刻だけの変更も含む", () => {
  const before = [{ id: "a", kind: "talk", startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-01T00:10:00.000Z" }, { id: "b", kind: "closing", startsAt: "2026-11-01T00:10:00.000Z", endsAt: "2026-11-01T00:15:00.000Z" }];
  assert.deepEqual(scheduleDiff(before, structuredClone(before)), []);
  const changes = scheduleDiff(before, [{ ...before[0], endsAt: "2026-11-01T00:11:00.000Z" }, { ...before[1], id: "c" }]);
  assert.deepEqual(changes.map(change => [change.id, change.minutes]), [["a", 0], ["b", null], ["c", null]]);
  assert.equal(scheduleDiff(before, [{ ...before[0], startsAt: "2026-10-31T23:55:00.000Z" }, before[1]])[0].minutes, -5);
});

test("対応一覧は終了・辞退済みを除き、受付順で複数理由をまとめる", () => {
  const base = { id: "a", eventState: "scheduled", review: "pending", withdrawal: "none", firstSubmittedAt: "2026-10-28T00:00:00.000Z", materialUrl: "", materialReviewed: false };
  const items = actionItems([{ ...base, id: "later", firstSubmittedAt: "2026-10-29T00:00:00.000Z", materialUrl: "https://example.invalid" }, { ...base, id: "ended", eventState: "ended" }, { ...base, id: "withdrawn", withdrawal: "confirmed" }, { ...base, id: "request", withdrawal: "requested" }, base]);
  assert.deepEqual(items.map(item => item.application.id), ["a", "request", "later"]);
  assert.deepEqual(items[0].reasons, ["審査待ち", "資料未提出"]);
  assert.deepEqual(items[1].reasons, ["辞退の確認待ち"]);
  assert.deepEqual(items[2].reasons, ["審査待ち", "資料未確認"]);
  assert.deepEqual(actionItems([{ ...base, review: "approved", materialUrl: "https://example.invalid", materialReviewed: true }]), []);
});
