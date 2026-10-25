import type { Application, PublicEvent } from "../../../contracts/lt/v1";
const event: PublicEvent = {
  id: "fixture-event",
  version: 1,
  title: "開発 fixture LT会",
  venue: "架空会場",
  guidance: "検証用データ",
  startsAt: "2030-01-01T01:00:00.000Z",
  endsAt: "2030-01-01T02:00:00.000Z",
  timeZone: "Asia/Tokyo",
  recruitment: "open",
  schedule: [],
};
const reviews: Application["review"][] = [
  "pending",
  "held",
  "approved",
  "returned",
  "resubmitted",
  "rejected",
  "withdrawn",
];
// 開発専用の架空データ。mutation は実接続と誤認させず失敗を返す
export async function fixture<T>(path: string): Promise<T> {
  const [route, query] = path.split("?");
  const second = new URLSearchParams(query).has("cursor");
  if (route === "/events")
    return { items: second ? [] : [event], nextCursor: second ? null : "fixture-next" } as T;
  if (route === `/events/${event.id}`) return event as T;
  if (route === "/auth/session") return { expiresAt: "2030-01-01T00:00:00.000Z" } as T;
  if (route === "/applications")
    return {
      items: second
        ? []
        : reviews.map(
            (review, i) =>
              ({
                id: `fixture-${review}`,
                eventId: event.id,
                version: 1,
                content: {
                  title: `架空申請 ${review}`,
                  abstract: "開発検証用",
                  speakers: [{ displayName: "架空発表者", affiliation: "架空所属" }],
                },
                materialUrl: "https://example.invalid/slides",
                representativeEmail: "fixture@example.invalid",
                review,
                withdrawal: i === 4 ? "requested" : "none",
                firstSubmittedAt: "2026-10-25T00:00:00.000Z",
                everApproved: ["approved", "returned", "resubmitted"].includes(review),
                slotReserved: ["approved", "returned", "resubmitted"].includes(review),
                retentionExpiresAt: null,
                published: null,
              }) satisfies Application,
          ),
      nextCursor: second ? null : "fixture-next",
    } as T;
  throw new Error("開発 fixture: この操作は未接続です");
}
