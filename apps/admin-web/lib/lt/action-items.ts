import type { OperatorApplication } from "../../../../contracts/lt/v1.ts";

export type ActionItem = { application: OperatorApplication; reasons: string[] };

/**
 * 対応が必要な申請を受付順にまとめる
 * @param applications 開催回の申請
 * @returns 辞退確認、審査、資料提出待ちを持つ申請
 */
export function actionItems(applications: OperatorApplication[]): ActionItem[] {
  return applications.flatMap(application => {
    if (["ended", "cancelled"].includes(application.eventState) ||
      ["rejected", "withdrawn"].includes(application.review) || application.withdrawal === "confirmed") return [];

    // 辞退依頼がある申請には、審査や提出を重ねて要求しない
    const reasons: string[] = [];
    if (application.withdrawal === "requested") reasons.push("辞退の確認待ち");
    else {
      if (application.waitlisted) reasons.push("キャンセル待ちの繰り上げ候補");
      else if (["pending", "resubmitted"].includes(application.review)) reasons.push("審査待ち");
      if (application.review === "held") reasons.push("保留の判断待ち");
      if (!application.materialUrl) reasons.push("資料未提出");
      else if (!application.materialReviewed) reasons.push("資料未確認");
    }
    return reasons.length ? [{ application, reasons }] : [];
  }).sort((a, b) => a.application.firstSubmittedAt.localeCompare(b.application.firstSubmittedAt) || a.application.id.localeCompare(b.application.id));
}
