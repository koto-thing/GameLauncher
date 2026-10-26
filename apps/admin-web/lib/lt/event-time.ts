import { Temporal } from "@js-temporal/polyfill";

/** @brief 保存日時を選択地域の入力値に変換する @param instant UTC日時 @param zone 地域 @returns 分単位の現地日時 */
export function localEventTime(instant: string, zone: string): string {
  return instant ? Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDateTime().toString({ smallestUnit: "minute" }) : "";
}

/** @brief 現地日時をUTCへ変換し、未編集値の精度を保つ @param local 現地日時 @param zone 地域 @param original 保存済み日時 @returns UTC日時 */
export function utcEventTime(local: string, zone: string, original = ""): string {
  if (original && localEventTime(original, zone) === local) return original;
  return Temporal.PlainDateTime.from(local).toZonedDateTime(zone, { disambiguation: "reject" }).toInstant().toString({ smallestUnit: "millisecond" });
}
