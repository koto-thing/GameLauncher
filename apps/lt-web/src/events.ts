import type { PublicEvent, PublicEventPage } from "../../../contracts/lt/v1";
/** 全ページを取得し、壊れた cursor の循環は失敗させる */
export async function allEvents(api: <T>(path: string) => Promise<T>): Promise<PublicEventPage> {
  const items: PublicEvent[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: PublicEventPage = await api<PublicEventPage>(
      "/events" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor) {
      if (seen.has(cursor)) throw new Error("開催回一覧のページ情報が不正です");
      seen.add(cursor);
    }
  } while (cursor);
  return { items, nextCursor: null };
}
export function formatInstant(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}
