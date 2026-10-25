import type { Application } from "../../../contracts/lt/v1";
// 表示の可否は補助であり、最終認可は API が行う
export function actions(a: Application) {
  if (a.withdrawal === "confirmed" || ["withdrawn", "rejected"].includes(a.review)) return [];
  const result: string[] = [];
  if ((!a.everApproved && ["pending", "held"].includes(a.review)) || a.review === "returned")
    if (a.content?.speakers.length === 1) result.push("edit");
  if (a.review === "returned") result.push("resubmit");
  if (!a.everApproved && ["pending", "held", "returned", "resubmitted"].includes(a.review))
    result.push("withdraw");
  if (a.everApproved && a.withdrawal === "none") result.push("request-withdrawal");
  if (a.withdrawal === "requested") result.push("cancel-withdrawal");
  return result;
}
