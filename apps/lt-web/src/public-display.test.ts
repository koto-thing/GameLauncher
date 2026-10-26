import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicSchedule } from "./PublicSchedule";
import { PublicTalkDetail } from "./PublicTalkDetail";
import { publicDate, durationMinutes } from "./public-display";
import type { PublicEvent, PublicTalk } from "../../../contracts/lt/v1";

const event: PublicEvent = {
  id: "event",
  version: 1,
  title: "LT会",
  venue: "M1教室",
  guidance: "",
  startsAt: "2026-11-03T04:00:00.000Z",
  endsAt: "2026-11-03T04:15:00.000Z",
  timeZone: "Asia/Tokyo",
  recruitment: "open",
  schedule: [
    {
      id: "slot",
      kind: "talk",
      talkId: "talk",
      startsAt: "2026-11-03T04:00:00.000Z",
      endsAt: "2026-11-03T04:10:00.000Z",
    },
    {
      id: "gap",
      kind: "transition",
      startsAt: "2026-11-03T04:10:00.000Z",
      endsAt: "2026-11-03T04:15:00.000Z",
    },
  ],
};
const talk: PublicTalk = {
  id: "talk",
  eventId: "event",
  version: 1,
  title: "公開発表",
  abstract: "概要\n二行目",
  description: "詳しい内容",
  speakers: [{ displayName: "登壇者", affiliation: "所属", profile: "プロフィール" }],
  startsAt: event.startsAt,
  endsAt: event.schedule[0].endsAt,
  cancelled: true,
};
const navigate = () => {};

describe("公開時間割と詳細", () => {
  it("各表示で同じ枠と詳細リンクを提供し、選択した形式をURLに保持する", () => {
    for (const view of ["table", "list"] as const) {
      const html = renderToStaticMarkup(
        createElement(PublicSchedule, {
          event,
          talks: { talk },
          view,
          onViewChange: navigate,
          navigate,
        }),
      );
      expect(html).toContain(`program-${view}`);
      expect(html).toContain(`/events/event/talks/talk?list=${view === "list" ? 1 : 0}`);
      expect(html).toContain("13:00");
      expect(html).toContain("13:15");
      expect(html).toContain("転換");
      expect(html).toContain("登壇中止");
      expect(html).toContain('aria-pressed="true"');
    }
  });
  it("詳細には公開内容と登壇者を表示し、元の一覧形式へ戻れる", () => {
    const html = renderToStaticMarkup(
      createElement(PublicTalkDetail, { event, talk, view: "list", navigate }),
    );
    for (const text of [
      "公開発表",
      "概要\n二行目",
      "詳しい内容",
      "プロフィール",
      "所属",
      "M1教室",
      "発表一覧に戻る",
      "/events/event?list=1#schedule",
    ])
      expect(html).toContain(text);
  });
  it("空の時間割と未取得の発表でも画面を表示する", () => {
    const html = renderToStaticMarkup(
      createElement(PublicSchedule, {
        event: { ...event, schedule: [] },
        talks: {},
        view: "table",
        onViewChange: navigate,
        navigate,
      }),
    );
    expect(html).toContain("時間割は未設定です");
    const loading = renderToStaticMarkup(
      createElement(PublicSchedule, {
        event,
        talks: {},
        view: "table",
        onViewChange: navigate,
        navigate,
      }),
    );
    expect(loading).toContain("発表詳細を確認する");
  });
  it("端末の地域に依存せず開催地の時刻と日跨ぎの長さを示す", () => {
    expect(publicDate(event.startsAt, "Asia/Tokyo", true)).toBe("13:00");
    expect(publicDate(event.startsAt, "UTC", true)).toBe("04:00");
    expect(durationMinutes("2026-11-03T23:55:00Z", "2026-11-04T00:05:00Z")).toBe(10);
  });
});
