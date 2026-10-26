import test from "node:test";
import assert from "node:assert/strict";
import { moveSchedule, reflowSchedule, scheduleGroups } from "../lib/lt/timetable.ts";

const start = Date.parse("2026-11-03T04:00:00.000Z");
const at = minute => new Date(start + minute * 60000).toISOString();
const blocks = [
  { id: "open", kind: "opening", startsAt: at(0), endsAt: at(5) },
  { id: "a", kind: "talk", talkId: "a", startsAt: at(5), endsAt: at(15) },
  { id: "at", kind: "transition", startsAt: at(15), endsAt: at(20) },
  { id: "b", kind: "talk", talkId: "b", startsAt: at(20), endsAt: at(30) },
  { id: "bt", kind: "transition", startsAt: at(30), endsAt: at(35) },
  { id: "rest", kind: "break", startsAt: at(35), endsAt: at(40) },
  { id: "close", kind: "closing", startsAt: at(40), endsAt: at(45) },
];

test("離れた位置への移動でも発表と転換を一緒に挿入し、長さと連続性を保つ", () => {
  const moved = moveSchedule(blocks, "a", "rest");
  assert.deepEqual(moved.map(b => b.id), ["open", "b", "bt", "rest", "a", "at", "close"]);
  assert.equal(moved[4].startsAt, at(25));
  assert.equal(moved[4].endsAt, at(35));
  assert.equal(moved[5].endsAt, at(40));
  assert.equal(moved.at(-1).endsAt, at(45));
  assert.equal(blocks[1].startsAt, at(5));
  assert.deepEqual(scheduleGroups(moved).map(g => g.length), [1, 2, 1, 2, 1]);
});

test("開会と閉会を端から移動しない", () => {
  assert.equal(moveSchedule(blocks, "a", "open"), blocks);
  assert.equal(moveSchedule(blocks, "close", "b"), blocks);
  assert.equal(moveSchedule(blocks, "missing", "b"), blocks);
});

test("転換0分と日付をまたぐ連続配置", () => {
  const moved = reflowSchedule([{ ...blocks[1] }, { ...blocks[2], endsAt: blocks[2].startsAt }], "2026-11-03T23:55:00.000Z");
  assert.equal(moved[0].endsAt, "2026-11-04T00:05:00.000Z");
  assert.equal(moved[1].startsAt, moved[1].endsAt);
});
