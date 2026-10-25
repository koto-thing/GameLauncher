import { describe, it, expect } from "vite-plus/test";
import { allEvents, formatInstant } from "./events";
import { fixture } from "./fixture";
import type { Application, PublicTalk } from "../../../contracts/lt/v1";
describe("fixture 結合", () => {
  it("全ページ取得", async () => expect((await allEvents(fixture)).items).toHaveLength(1));
  it("JST 日付跨ぎと登壇中止", async () => {
    const talk = await fixture<PublicTalk>("/events/fixture-event/talks/fixture-talk");
    expect(talk.cancelled).toBe(true);
    expect(formatInstant(talk.startsAt, "Asia/Tokyo")).toContain("2030年1月2日");
    expect(talk.description).toBeUndefined();
  });
  it("本人詳細の任意情報を保持して編集", async () => {
    const a = await fixture<Application>("/applications/fixture-pending");
    const b = await fixture<Application>("/applications/fixture-pending", {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: 1,
        data: { content: a.content, materialUrl: a.materialUrl },
      }),
    });
    expect(b.content.speakers).toEqual(a.content.speakers);
  });
  it("辞退依頼の取消", async () =>
    expect(
      (
        await fixture<Application>("/applications/fixture-resubmitted/cancel-withdrawal", {
          method: "POST",
          body: JSON.stringify({ expectedVersion: 1 }),
        })
      ).withdrawal,
    ).toBe("none"));
  it("期限切れ/未認証/競合を成功にしない", async () => {
    await expect(fixture("/applications/fixture-expired")).rejects.toThrow("RETENTION_EXPIRED");
    await expect(fixture("/applications/fixture-unauthenticated")).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    await expect(
      fixture("/applications/fixture-pending", {
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 2 }),
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
  });
});
