import type { EventSettings, ScheduleBlock } from "../../../../contracts/lt/v1.ts";
import { reflowSchedule } from "./timetable.ts";

/**
 * 固定枠を維持して保存時と同じルールで時間割を生成する
 * @param blocks 編集した発表順と固定枠
 * @param event 開催設定
 * @returns 確定予定の時間割
 * @throws 固定枠の衝突、固定枠の長さ変更、終了上限の超過がある場合
 */
export function previewSchedule(blocks: ScheduleBlock[], event: EventSettings): ScheduleBlock[] {
  const old = new Map(blocks.map(block => [block.id, block]));
  const pieces: ScheduleBlock[] = [];

  /**
   * 設定された長さの枠を追加し、固定済み時刻を引き継ぐ
   * @param id 枠のID
   * @param kind 枠の種別
   * @param minutes 枠の長さ
   * @param talkId 対応する発表ID
   * @returns 戻り値なし
   */
  function append(id: string, kind: ScheduleBlock["kind"], minutes: number, talkId?: string) {
    const previous = old.get(id);
    if (previous?.locked) {
      if (Date.parse(previous.endsAt) - Date.parse(previous.startsAt) !== minutes * 60000) throw new Error("固定枠の長さが開催設定と一致しません。固定を解除してから時間を変更してください");
      pieces.push(previous);
    } else pieces.push({ id, kind, ...(talkId ? { talkId } : {}), startsAt: event.startsAt, endsAt: new Date(Date.parse(event.startsAt) + minutes * 60000).toISOString() });
  }

  if (event.scheduleMode === "automatic") {
    const talks = blocks.filter(block => block.kind === "talk");
    const fixedBreaks = blocks.filter(block => block.kind === "break" && block.locked);
    if (event.openingMinutes) append("auto:opening", "opening", event.openingMinutes);

    // 固定休憩は、元の並びでその前にある発表数を基準に残す
    for (let count = 0; count <= talks.length; count++) {
      if (count > 0) {
        const talk = talks[count - 1];
        append(talk.id, "talk", event.talkMinutes, talk.talkId);
        append(`${talk.id}:transition`, "transition", event.transitionMinutes);
        const breakId = `auto:break:${talk.talkId}`;
        if (count < talks.length && count % event.breakEvery === 0 && event.breakMinutes && !old.get(breakId)?.locked) append(breakId, "break", event.breakMinutes);
      }
      for (const rest of fixedBreaks) {
        if (blocks.slice(0, blocks.indexOf(rest)).filter(block => block.kind === "talk").length === count) pieces.push(rest);
      }
    }
    if (event.closingMinutes) append("auto:closing", "closing", event.closingMinutes);
    for (const block of blocks) {
      if (block.locked && !pieces.some(piece => piece.id === block.id)) throw new Error("固定枠が生成ルールから外れます。固定を解除してからルールを変更してください");
    }
  } else {
    for (const block of blocks) append(block.id, block.kind, block.kind === "talk" ? event.talkMinutes : block.kind === "transition" ? event.transitionMinutes : (Date.parse(block.endsAt) - Date.parse(block.startsAt)) / 60000, block.talkId);
  }

  const result = reflowSchedule(pieces, event.startsAt);
  const end = result.at(-1)?.endsAt ?? event.startsAt;
  if (event.endsBy && Date.parse(end) > Date.parse(event.endsBy)) throw new Error(`終了上限を${Math.ceil((Date.parse(end) - Date.parse(event.endsBy)) / 60000)}分超過します。固定時刻・発表順・開催設定を調整してください`);
  return result;
}

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
