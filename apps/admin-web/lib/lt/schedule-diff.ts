import type { ScheduleBlock } from "../../../../contracts/lt/v1.ts";

export type ScheduleChange = { id: string; before?: ScheduleBlock; after?: ScheduleBlock; minutes: number | null };

/**
 * 保存済み時間割と編集結果の追加、削除、時刻変更を比較する
 * @param before 保存済み時間割
 * @param after 確定予定の時間割
 * @returns 変更された枠と開始時刻の移動分数
 */
export function scheduleDiff(before: ScheduleBlock[], after: ScheduleBlock[]): ScheduleChange[] {
  const old = new Map(before.map(block => [block.id, block]));
  const next = new Map(after.map(block => [block.id, block]));
  return [...new Set([...old.keys(), ...next.keys()])].flatMap(id => {
    const previous = old.get(id), current = next.get(id);
    if (previous && current && previous.startsAt === current.startsAt && previous.endsAt === current.endsAt && previous.kind === current.kind && previous.talkId === current.talkId && !!previous.locked === !!current.locked) return [];
    return [{ id, before: previous, after: current, minutes: previous && current ? (Date.parse(current.startsAt) - Date.parse(previous.startsAt)) / 60000 : null }];
  });
}
