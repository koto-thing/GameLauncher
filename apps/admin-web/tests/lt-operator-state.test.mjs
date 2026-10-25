import test from "node:test";
import assert from "node:assert/strict";
import { canReapprove, canReview, syncTimetableEvent } from "../lib/lt/operator-state.ts";

test("差し戻し直後は再承認不可、本人再提出後だけ許可", () => {
  assert.equal(canReapprove({ everApproved: true, review: "returned" }), false);
  assert.equal(canReapprove({ everApproved: true, review: "resubmitted" }), true);
  assert.equal(canReapprove({ everApproved: false, review: "resubmitted" }), false);
});

test("時間割保存後は開催回versionを同期して連続保存と次の承認に使う", () => {
  let event = { id: "event", version: 1 };
  event = syncTimetableEvent(event, { eventId: "event", version: 2, eventVersion: 2, blocks: [] });
  assert.equal(event.version, 2);
  event = syncTimetableEvent(event, { eventId: "event", version: 3, eventVersion: 3, blocks: [] });
  assert.equal(event.version, 3);
  assert.equal(syncTimetableEvent(event, { eventId: "other", eventVersion: 9 }).version, 3);
});

test("終了した申請の審査操作と承認履歴のある見送りを止める", () => {
  for (const review of ["rejected", "withdrawn"]) for (const action of ["approve", "return", "hold", "reject", "reapprove"]) assert.equal(canReview({ review, everApproved: false }, action), false);
  assert.equal(canReview({ review: "returned", everApproved: true }, "reject"), false);
  assert.equal(canReview({ review: "pending", everApproved: false }, "reject"), true);
});
