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
  schedule: [
    {
      id: "fixture-slot",
      kind: "talk",
      talkId: "fixture-talk",
      startsAt: "2030-01-01T15:00:00.000Z",
      endsAt: "2030-01-01T15:10:00.000Z",
    },
  ],
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
export async function fixture<T>(path: string, init: RequestInit = {}): Promise<T> {
  const [route, query] = path.split("?");
  const second = new URLSearchParams(query).has("cursor");
  if (route === "/applications/fixture-expired") throw new Error("RETENTION_EXPIRED (fixture)");
  if (route === "/applications/fixture-unauthenticated")
    throw new Error("UNAUTHENTICATED (fixture)");
  if (route?.includes("/talks/"))
    return {
      id: "fixture-talk",
      eventId: event.id,
      version: 1,
      title: "架空発表",
      abstract: "開発 fixture",
      speakers: [
        {
          displayName: "架空発表者",
          links: [{ label: "ポートフォリオ", url: "https://example.com/" }],
        },
      ],
      session: {
        field: "programming",
        relatedFields: ["ENG", "GD"],
        keywords: ["Unity", "シェーダー"],
        platforms: ["PC", "Web"],
        difficulty: "normal",
        prerequisites: "Unityの基本操作\nC#の基礎",
        takeaways: "描画の仕組み\n実装の方法",
      },
      startsAt: "2030-01-01T15:00:00.000Z",
      endsAt: "2030-01-01T15:10:00.000Z",
      cancelled: true,
    } as T;
  if (route?.startsWith("/applications/")) {
    const [, , id, action] = route.split("/");
    const page = await fixture<{ items: Application[] }>("/applications");
    const application = page.items.find((a) => a.id === id);
    if (!application) throw new Error("NOT_FOUND (fixture)");
    if (init.method) {
      const input = JSON.parse(String(init.body));
      if (input.expectedVersion !== application.version)
        throw new Error("VERSION_CONFLICT (fixture)");
      if (init.method === "PATCH")
        return { ...application, ...input.data, version: application.version + 1 } as T;
      if (action === "request-withdrawal")
        return { ...application, withdrawal: "requested", version: 2 } as T;
      if (action === "cancel-withdrawal")
        return { ...application, withdrawal: "none", version: 2 } as T;
      throw new Error("INVALID_TRANSITION (fixture)");
    }
    return application as T;
  }
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
                eventState: "scheduled",
                eventCancelledAt: null,
                published: null,
              }) satisfies Application,
          ),
      nextCursor: second ? null : "fixture-next",
    } as T;
  throw new Error("開発 fixture: この操作は未接続です");
}
