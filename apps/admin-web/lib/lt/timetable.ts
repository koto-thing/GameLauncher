import type { ScheduleBlock } from "../../../../contracts/lt/v1.ts";

/** @brief 転換を直前の発表終了から開催回の固定時間で計算する @param blocks 時間割 @param minutes 転換分数 @returns 固定時間を適用した時間割 */
export function fixedTransitions(blocks: ScheduleBlock[], minutes: number): ScheduleBlock[] {
  return blocks.map((block, index) => {
    if (block.kind !== "transition") return block;
    const previous = blocks[index - 1];
    if (previous?.kind !== "talk" || !Number.isFinite(minutes) || minutes < 0) throw new Error("転換設定を確認してください");
    return { ...block, startsAt: previous.endsAt, endsAt: new Date(Date.parse(previous.endsAt) + minutes * 60000).toISOString() };
  });
}

/** @brief 発表と直後の転換を一組にまとめる @param blocks 時間割 @returns 移動単位 */
export function scheduleGroups(blocks: ScheduleBlock[]): ScheduleBlock[][] {
  const groups: ScheduleBlock[][] = [];
  for (const block of blocks) {
    const previous = groups.at(-1);
    if (block.kind === "transition" && previous?.[0].kind === "talk" && previous.length === 1) previous.push(block);
    else groups.push([block]);
  }
  return groups;
}

/** @brief 各枠の長さを保って連続配置する @param blocks 時間割 @param start 開始日時 @returns 再計算した時間割 */
export function reflowSchedule(blocks: ScheduleBlock[], start: string): ScheduleBlock[] {
  let cursor = Date.parse(start);
  if (!Number.isFinite(cursor) || blocks.some(b => !Number.isFinite(Date.parse(b.endsAt) - Date.parse(b.startsAt)) || Date.parse(b.endsAt) < Date.parse(b.startsAt))) return blocks;
  return blocks.map(block => {
    const duration = Date.parse(block.endsAt) - Date.parse(block.startsAt);
    const startsAt = new Date(cursor).toISOString();
    cursor += duration;
    return { ...block, startsAt, endsAt: new Date(cursor).toISOString() };
  });
}

/** @brief 発表と転換を一緒に移動し、開会と閉会を端に保つ @param blocks 時間割 @param from 移動元ID @param to 移動先ID @returns 新しい時間割 */
export function moveSchedule(blocks: ScheduleBlock[], from: string, to: string): ScheduleBlock[] {
  const groups = scheduleGroups(blocks);
  const source = groups.findIndex(group => group[0].id === from);
  const target = groups.findIndex(group => group[0].id === to);
  if (source < 0 || target < 0 || source === target || [groups[source][0], groups[target][0]].some(b => b.kind === "opening" || b.kind === "closing")) return blocks;
  const [moved] = groups.splice(source, 1);
  groups.splice(target, 0, moved);
  return reflowSchedule(groups.flat(), blocks[0].startsAt);
}
