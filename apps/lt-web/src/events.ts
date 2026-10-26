import type { PublicEvent, PublicEventPage } from "../../../contracts/lt/v1";
/**
 * 全ページを取得し、カーソルの循環を検出する
 *
 * @param api 公開 API の JSON を取得する関数
 * @returns 全開催回をまとめた、次ページを持たない一覧
 */
export async function allEvents(api: <T>(path: string) => Promise<T>): Promise<PublicEventPage> {
  const items: PublicEvent[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  // 次ページがなくなるまで開催回を取得順に追加する
  do {
    const page: PublicEventPage = await api<PublicEventPage>(
      "/events" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    items.push(...page.items);
    cursor = page.nextCursor;

    // 同じカーソルで無限に取得を繰り返すことを防ぐ
    if (cursor) {
      if (seen.has(cursor)) throw new Error("開催回一覧のページ情報が不正です");
      seen.add(cursor);
    }
  } while (cursor);
  return { items, nextCursor: null };
}
/**
 * 指定地域の日時を日本語で表示する
 *
 * @param value 変換する日時文字列
 * @param timeZone 表示先の IANA タイムゾーン
 * @returns 日付と時刻を含む表示文字列
 */
export function formatInstant(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}
