import type { Application } from "../../../contracts/lt/v1";
/**
 * 申請状態から画面に表示する操作を選ぶ
 *
 * @param a 開催回と審査・辞退の状態を含む申請
 * @returns 表示可能な操作名の一覧、最終認可は API が行う
 */
export function actions(a: Application) {
  // 中止済みや終了した申請では操作を表示しない
  if (a.eventState === "cancelled") return [];
  if (a.withdrawal === "confirmed" || ["withdrawn", "rejected"].includes(a.review)) return [];

  // 承認履歴と現在の状態から編集・再提出・辞退の操作を選ぶ
  const result: string[] = [];
  if ((!a.everApproved && ["pending", "held"].includes(a.review)) || a.review === "returned")
    result.push("edit");
  if (a.review === "returned") result.push("resubmit");
  if (!a.everApproved && ["pending", "held", "returned", "resubmitted"].includes(a.review))
    result.push("withdraw");
  if (a.everApproved && a.withdrawal === "none") result.push("request-withdrawal");
  if (a.withdrawal === "requested") result.push("cancel-withdrawal");
  return result;
}
