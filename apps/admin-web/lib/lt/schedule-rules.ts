import type { EventSettings } from "../../../../contracts/lt/v1";

/**
 * 開会・転換・休憩・閉会を含めて終了上限までの募集可能数を計算する
 *
 * @param event UTC日時と時間割ルールを含む開催設定
 * @returns 終了上限がなければ設定済み定員、上限があれば配置可能な発表数
 */
export function scheduleCapacity(event: Pick<EventSettings, "startsAt" | "endsBy" | "capacity" | "talkMinutes" | "transitionMinutes" | "openingMinutes" | "closingMinutes" | "breakEvery" | "breakMinutes">): number {
  if (!event.endsBy) return event.capacity;

  const available = Date.parse(event.endsBy) - Date.parse(event.startsAt);
  if (!Number.isFinite(available) || event.breakEvery < 1 || event.talkMinutes < 1) return 0;

  // 最後の発表後の休憩を除き、設定した終了上限に収まる最大件数を求める
  let low = 0, high = 10001;
  while (low + 1 < high) {
    const count = Math.floor((low + high) / 2);
    const minutes = event.openingMinutes + event.closingMinutes
      + count * (event.talkMinutes + event.transitionMinutes)
      + Math.floor((count - 1) / event.breakEvery) * event.breakMinutes;
    if (minutes * 60000 <= available) low = count;
    else high = count;
  }
  return low;
}
