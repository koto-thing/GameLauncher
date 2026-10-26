import type { MouseEvent } from "react";

/**
 * 開催地域の日時を整形する
 *
 * @param value UTC日時
 * @param zone 地域
 * @param time 時刻表示
 * @returns 表示文字列
 */
export function publicDate(value: string, zone: string, time = false): string {
  return new Intl.DateTimeFormat(
    "ja-JP",
    time
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }
      : { year: "numeric", month: "long", day: "numeric", weekday: "short", timeZone: zone },
  ).format(new Date(value));
}

/**
 * 発表時間を分で表示する
 *
 * @param start 開始
 * @param end 終了
 * @returns 分数
 */
export function durationMinutes(start: string, end: string): number {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000));
}

/**
 * 通常クリックだけ画面内で遷移し、新規タブ操作を保つ
 *
 * @param e クリック
 * @param href 遷移先
 * @param navigate 遷移処理
 * @returns 戻り値なし
 */
export function followPublicLink(
  e: MouseEvent<HTMLAnchorElement>,
  href: string,
  navigate: (href: string) => void,
): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(href);
}
