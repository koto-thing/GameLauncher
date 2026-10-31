import { expect, it } from "vite-plus/test";
import { canChangeTitle } from "../../../contracts/lt/application-policy";
import type { Application } from "../../../contracts/lt/v1";
import fixture from "../../../contracts/lt/application.fixture.json";

it("承認後と再提出後もタイトル変更を許可する", () => {
  for (const review of ["pending", "held", "approved", "returned", "resubmitted"] as const) {
    expect(canChangeTitle({ ...fixture, review } as Application)).toBe(true);
  }
});

it("中止・取り下げ・見送り・辞退確定は変更を許可しない", () => {
  for (const state of [
    { eventState: "cancelled" },
    { review: "withdrawn" },
    { review: "rejected" },
    { withdrawal: "confirmed" },
  ]) {
    expect(canChangeTitle({ ...fixture, ...state } as Application)).toBe(false);
  }
});
