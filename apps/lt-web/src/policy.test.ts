import { describe, expect, it } from "vite-plus/test";
import type { Application } from "../../../contracts/lt/v1";
import { actions } from "./policy";
const a = {
  content: { speakers: [{ displayName: "架空発表者" }] },
  review: "pending",
  withdrawal: "none",
  everApproved: false,
} as Application;
describe("本人操作の表示", () => {
  it("未承認のみ編集と取り下げ", () => expect(actions(a)).toEqual(["edit", "withdraw"]));
  it("承認後は辞退依頼", () =>
    expect(actions({ ...a, review: "approved", everApproved: true })).toEqual([
      "request-withdrawal",
    ]));
  it("確定後は操作不可", () => expect(actions({ ...a, withdrawal: "confirmed" })).toEqual([]));
  it("依頼中は取消", () =>
    expect(
      actions({ ...a, review: "approved", everApproved: true, withdrawal: "requested" }),
    ).toEqual(["cancel-withdrawal"]));
});
