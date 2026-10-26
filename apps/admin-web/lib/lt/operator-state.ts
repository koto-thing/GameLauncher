import policy from "../../../../contracts/lt/policy.json" with { type: "json" };
import type {
  EventSettings,
  OperatorApplication,
  OperatorTimetable,
} from "../../../../contracts/lt/v1.ts";

/**
 * 本人再提出後に限り再承認を許可する
 *
 * @param application 現在の申請
 * @returns 再承認可否
 */
export function canReapprove(application: OperatorApplication): boolean {
  return application.everApproved && canReview(application, "reapprove");
}

/**
 * 時間割保存で更新された開催回versionを同期する
 *
 * @param event 現在の開催回
 * @param timetable 保存結果
 * @returns 同期した開催回
 */
export function syncTimetableEvent(
  event: EventSettings,
  timetable: OperatorTimetable,
): EventSettings {
  return event.id === timetable.eventId ? { ...event, version: timetable.eventVersion } : event;
}

/**
 * 共有遷移ポリシーに従って審査操作を制限する
 *
 * @param application 現在の申請
 * @param action 審査操作
 * @returns 操作可否
 */
export function canReview(
  application: OperatorApplication,
  action: keyof typeof policy.transitions,
): boolean {
  const states: readonly string[] = policy.transitions[action];
  if (!states.includes(application.review)) return false;
  if (action === "approve" || action === "reject") return !application.everApproved;
  return true;
}
