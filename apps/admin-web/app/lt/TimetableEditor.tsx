"use client";
import { useState, type ReactNode } from "react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { fixedTransitions, moveSchedule, reflowSchedule, scheduleGroups } from "../../lib/lt/timetable";
import { localEventTime, utcEventTime } from "../../lib/lt/event-time";
import { previewSchedule } from "../../lib/lt/schedule-rules";
import { scheduleDiff } from "../../lib/lt/schedule-diff";
import type { ScheduleBlock, EventSettings, OperatorApplication } from "../../../../contracts/lt/v1";

const labels = { talk: "発表", transition: "転換", opening: "開会", break: "休憩", closing: "閉会" };

/** @brief ハンドルから操作する時間割カード @param props カード情報 @returns 並び替え可能な枠 */
function ScheduleCard({ id, title, disabled, children }: { id: string; title: string; disabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .35 : 1 }}>
    <div className="lt-schedule-heading"><button type="button" className="lt-drag-handle" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled} aria-label={`${title}を並べ替え`}><GripVertical aria-hidden="true" /></button><strong>{title}</strong></div>
    {children}
  </li>;
}

/**
 * 開催地域の日時で時間割を編集し、自動方式では発表順だけを変更する
 * @param props 時間割編集の入力
 * @param props.blocks 保存済みの時間割
 * @param props.event 開催設定と生成ルール
 * @param props.applications 表示名を取得する申請一覧
 * @param props.onSave 編集済みの時間割を保存する処理
 * @param props.disabled 編集を禁止するか
 * @returns 時間割の編集画面
 */
export function TimetableEditor({ blocks, event, applications, onSave, disabled }: { blocks: ScheduleBlock[]; event: EventSettings; applications: OperatorApplication[]; onSave: (blocks: ScheduleBlock[]) => void; disabled: boolean }) {
  const zone = event.timeZone;
  const automatic = event.scheduleMode === "automatic";
  // 入力途中の日時も保持し、保存と並び替えの直前にUTCへ変換する
  const localize = (items: ScheduleBlock[]) => items.map(b => ({ ...b, startsAt: localEventTime(b.startsAt, zone), endsAt: localEventTime(b.endsAt, zone) }));
  const [draft, setDraft] = useState(() => localize(blocks));
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ScheduleBlock[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const groups = scheduleGroups(draft);

  /** @brief 入力日時を保存形式へ変換する @returns UTC時間割 */
  function utcDraft() {
    return fixedTransitions(draft.map(b => {
      if (b.kind === "transition") return b;
      const original = blocks.find(item => item.id === b.id);
      return { ...b, startsAt: utcEventTime(b.startsAt, zone, original?.startsAt), endsAt: utcEventTime(b.endsAt, zone, original?.endsAt) };
    }), event.transitionMinutes);
  }

  /** @brief 入力エラーを画面へ表示する @param action 編集操作 */
  function edit(action: () => ScheduleBlock[]) {
    try { const items = action(); setDraft(localize(automatic ? previewSchedule(items, event) : items)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "日時を確認してください"); }
  }

  /** @brief タイトルと登壇者を表示する @param block 枠 @returns 表示名 */
  function title(block: ScheduleBlock) {
    const application = applications.find(item => item.id === block.talkId);
    const content = application?.published ?? application?.content;
    return content ? `${content.speakers.map(s => s.displayName).join("、")} — ${content.title}` : labels[block.kind];
  }

  /**
   * 時間割を検証して確定前の差分を表示する
   * @returns 戻り値なし
   */
  function save() {
    try {
      const items = automatic ? previewSchedule(utcDraft(), event) : utcDraft();
      let cursor = Date.parse(event.startsAt);
      for (const b of items) {
        const start = Date.parse(b.startsAt), end = Date.parse(b.endsAt);
        if (start < cursor || end < start || (end === start && b.kind !== "transition")) { setError("開催開始より前、または直前の枠と重複する時刻です。「固定枠を保って自動調整」で整えられます。"); return; }
        if ((b.kind === "talk" && end - start !== event.talkMinutes * 60000) || (b.kind === "transition" && end - start !== event.transitionMinutes * 60000)) { setError(`発表は${event.talkMinutes}分、転換は${event.transitionMinutes}分で指定してください。共通の長さは開催回の設定で変更できます。`); return; }
        cursor = end;
      }
      setError(""); setPreview(items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "各枠の日時を確認してください"); }
  }

  /** @brief 開会・休憩・閉会を適切な位置へ追加する @param kind 種類 */
  function add(kind: "opening" | "break" | "closing") {
    edit(() => {
      const items = utcDraft();
      const block = { id: crypto.randomUUID(), kind, startsAt: event.startsAt, endsAt: new Date(Date.parse(event.startsAt) + 5 * 60000).toISOString() };
      const closing = items.findIndex(b => b.kind === "closing");
      items.splice(kind === "opening" ? 0 : closing < 0 ? items.length : closing, 0, block);
      return reflowSchedule(items, event.startsAt);
    });
  }

  return <fieldset disabled={disabled}><legend>時間割</legend>
    {automatic && <p>発表順を変更できます。固定した枠はその時刻を保ち、残りを開催ルールから計算します。固定済みの時刻を変える場合は、先に固定を解除して確定してください。</p>}
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={preview !== null}><legend>枠の編集</legend>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={({ active }) => setActiveId(String(active.id))} onDragCancel={() => setActiveId(null)} onDragEnd={({ active, over }) => { setActiveId(null); if (!disabled && over && active.id !== over.id) edit(() => moveSchedule(utcDraft(), String(active.id), String(over.id))); }}>
      <SortableContext items={groups.map(g => g[0].id)} strategy={verticalListSortingStrategy}>
        <ol className="lt-schedule-list">{groups.map(group => <ScheduleCard key={group[0].id} id={group[0].id} title={title(group[0])} disabled={disabled || (automatic && group[0].kind !== "talk") || group[0].kind === "opening" || group[0].kind === "closing"}>
          {group.filter(block => block.kind !== "transition").map(block => <div key={block.id} className="lt-schedule-times" role="group" aria-label={labels[block.kind]}><span className="lt-badge">{labels[block.kind]}</span>
            <div className="lt-schedule-range">{(["startsAt", "endsAt"] as const).map(field => <span key={field} className="lt-schedule-endpoint">{field === "endsAt" && <span aria-hidden="true">～</span>}<input aria-label={`${labels[block.kind]}の${field === "startsAt" ? "開始日時" : "終了日時"}`} type="datetime-local" step="60" readOnly={block.locked || (automatic && field === "endsAt")} value={block[field]} onClick={e => { if (!block.locked && !(automatic && field === "endsAt")) e.currentTarget.showPicker?.(); }} onChange={e => { const value = e.currentTarget.value; setDraft(items => items.map(item => { if (item.id !== block.id) return item; if (field === "startsAt" && value) { try { const duration = Date.parse(utcEventTime(item.endsAt, zone)) - Date.parse(utcEventTime(item.startsAt, zone)); return { ...item, startsAt: value, endsAt: localEventTime(new Date(Date.parse(utcEventTime(value, zone)) + duration).toISOString(), zone) }; } catch { return { ...item, startsAt: value }; } } return { ...item, [field]: value }; })); }} /></span>)}</div>
            <label><input type="checkbox" checked={!!block.locked} onChange={e => { const locked = e.currentTarget.checked; setDraft(items => items.map(item => item.id === block.id ? { ...item, locked } : item)); }} />この枠の時刻を固定</label>
          </div>)}
          {!automatic && !group[0].locked && group[0].kind !== "talk" && <button type="button" onClick={() => edit(() => reflowSchedule(utcDraft().filter(b => b.id !== group[0].id), event.startsAt))}>削除</button>}
        </ScheduleCard>)}</ol>
      </SortableContext>
      <DragOverlay>{activeId && <div className="lt-schedule-overlay">{title(draft.find(b => b.id === activeId)!)}</div>}</DragOverlay>
    </DndContext>
    {!automatic && <div>{(["opening", "break", "closing"] as const).map(kind => <button key={kind} type="button" disabled={kind !== "break" && draft.some(b => b.kind === kind)} onClick={() => add(kind)}>{labels[kind]}を追加</button>)}</div>}
    <button type="button" onClick={() => edit(() => previewSchedule(utcDraft(), event))}>固定枠を保って自動調整</button>
    <button type="button" onClick={save}>変更をプレビュー</button><button type="button" onClick={() => { setDraft(localize(blocks)); setPreview(null); setError(""); }}>編集を取り消す</button>
    </fieldset>
    {preview && <section aria-label="時間割変更の確認"><h3>変更前後の確認</h3><p>以下の時刻は{zone}です</p>
      <div className="lt-table-scroll"><table className="lt-table"><thead><tr><th>枠</th><th>変更前</th><th>変更後</th><th>移動</th><th>固定</th></tr></thead><tbody>{scheduleDiff(blocks, preview).map(change => <tr key={change.id}>
        <td>{title((change.after ?? change.before)!)}</td>
        <td>{change.before ? `${localEventTime(change.before.startsAt, zone)} ～ ${localEventTime(change.before.endsAt, zone)}` : "追加"}</td>
        <td>{change.after ? `${localEventTime(change.after.startsAt, zone)} ～ ${localEventTime(change.after.endsAt, zone)}` : "削除"}</td>
        <td>{change.minutes === null ? "—" : `${change.minutes > 0 ? "+" : ""}${change.minutes}分`}</td>
        <td>{change.after?.locked ? "固定" : "固定なし"}</td>
      </tr>)}</tbody></table></div>
      <button type="button" onClick={() => { onSave(preview); setPreview(null); }}>この変更を一括確定</button>
      <button type="button" onClick={() => setPreview(null)}>確認を閉じる</button>
    </section>}
  </fieldset>;
}
