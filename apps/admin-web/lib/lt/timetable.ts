import type { ScheduleBlock } from "../../../../contracts/lt/v1.ts";

/** @brief 並び替え後の時間を各項目の長さを保って連続配置する @param blocks 元の時間割 @param index 移動元 @param offset 移動方向 @returns 新しい時間割 */
export function moveSchedule(blocks: ScheduleBlock[], index: number, offset: number): ScheduleBlock[] {
  const target = index + offset;
  if (index < 0 || target < 0 || index >= blocks.length || target >= blocks.length) return blocks;
  const next = blocks.map(block => ({ ...block }));
  [next[index], next[target]] = [next[target], next[index]];

  // 未入力がある間は順序だけを編集し、保存時に日時を検証する
  let cursor = Date.parse(blocks[0].startsAt);
  if (!Number.isFinite(cursor) || next.some(block => !(Date.parse(block.endsAt) > Date.parse(block.startsAt)))) return next;
  return next.map(block => {
    const duration = Date.parse(block.endsAt) - Date.parse(block.startsAt);
    const startsAt = new Date(cursor).toISOString();
    cursor += duration;
    return { ...block, startsAt, endsAt: new Date(cursor).toISOString() };
  });
}
