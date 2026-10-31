import type { Application } from "./v1";

/**
 * 申請のタイトル・概要変更操作を表示できるか判定する
 * @param application 対象の申請と開催状態
 * @returns 中止・取り下げ・見送り・辞退確定以外の場合はtrue
 */
export function canChangePresentation(application: Application): boolean {
  return (
    application.eventState !== "cancelled" &&
    application.withdrawal !== "confirmed" &&
    !["withdrawn", "rejected"].includes(application.review)
  );
}
