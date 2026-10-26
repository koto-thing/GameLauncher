"use client";
import { useState, type ReactNode } from "react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { fixedTransitions, moveSchedule, reflowSchedule, scheduleGroups } from "../../lib/lt/timetable";
import { localEventTime, utcEventTime } from "../../lib/lt/event-time";
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

/** @brief 開催地域の日時で時間割を編集する @param props 保存済み時間割と開催設定 @returns 編集画面 */
export function TimetableEditor({ blocks, event, applications, onSave, disabled }: { blocks: ScheduleBlock[]; event: EventSettings; applications: OperatorApplication[]; onSave: (blocks: ScheduleBlock[]) => void; disabled: boolean }) {
  const zone = event.timeZone;
  // 入力途中の日時も保持し、保存と並び替えの直前にUTCへ変換する
  const localize = (items: ScheduleBlock[]) => items.map(b => ({ ...b, startsAt: localEventTime(b.startsAt, zone), endsAt: localEventTime(b.endsAt, zone) }));
  const [draft, setDraft] = useState(() => localize(blocks));
  const [error, setError] = useState("");
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
    try { setDraft(localize(action())); setError(""); }
    catch { setError("開始・終了日時を入力してください。夏時間の切替で存在しない、または重複する時刻も指定できません。"); }
  }

  /** @brief タイトルと登壇者を表示する @param block 枠 @returns 表示名 */
  function title(block: ScheduleBlock) {
    const application = applications.find(item => item.id === block.talkId);
    const content = application?.published ?? application?.content;
    return content ? `${content.speakers.map(s => s.displayName).join("、")} — ${content.title}` : labels[block.kind];
  }

  /** @brief 保存条件を確認して親へ渡す */
  function save() {
    try {
      const items = utcDraft();
      let cursor = Date.parse(event.startsAt);
      for (const b of items) {
        const start = Date.parse(b.startsAt), end = Date.parse(b.endsAt);
        if (start !== cursor || end < start || (end === start && b.kind !== "transition")) { setError("開催開始日時から、隙間や重複がないように指定してください。「時刻を連続配置」で整えられます。"); return; }
        if ((b.kind === "talk" && end - start !== event.talkMinutes * 60000) || (b.kind === "transition" && end - start !== event.transitionMinutes * 60000)) { setError(`発表は${event.talkMinutes}分、転換は${event.transitionMinutes}分で指定してください。共通の長さは開催回の設定で変更できます。`); return; }
        cursor = end;
      }
      setError(""); onSave(items);
    } catch { setError("各枠の開始・終了日時を確認してください。"); }
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
    <p className="lt-hint">左のハンドルをドラッグして並べ替えます。発表と転換は一緒に移動し、時刻を自動調整します。開会・閉会は先頭・末尾に固定されます。キーボードではハンドルでSpace、矢印キー、Spaceの順に操作できます。</p>
    <p className="lt-hint">日時は {zone === "Asia/Tokyo" ? "日本時間（Asia/Tokyo）" : zone}。発表{event.talkMinutes}分。転換は各発表の後に一律{event.transitionMinutes}分、自動で入ります。変更は開催回の設定から行えます。編集内容は「時間割を保存」で反映されます。</p>
    {error && <p role="alert">{error}</p>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={({ active }) => setActiveId(String(active.id))} onDragCancel={() => setActiveId(null)} onDragEnd={({ active, over }) => { setActiveId(null); if (!disabled && over && active.id !== over.id) edit(() => moveSchedule(utcDraft(), String(active.id), String(over.id))); }}>
      <SortableContext items={groups.map(g => g[0].id)} strategy={verticalListSortingStrategy}>
        <ol className="lt-schedule-list">{groups.map(group => <ScheduleCard key={group[0].id} id={group[0].id} title={title(group[0])} disabled={disabled || group[0].kind === "opening" || group[0].kind === "closing"}>
          {group.filter(block => block.kind !== "transition").map(block => <div key={block.id} className="lt-schedule-times" role="group" aria-label={labels[block.kind]}><span className="lt-badge">{labels[block.kind]}</span>
            <div className="lt-schedule-range">{(["startsAt", "endsAt"] as const).map(field => <span key={field} className="lt-schedule-endpoint">{field === "endsAt" && <span aria-hidden="true">～</span>}<input aria-label={`${labels[block.kind]}の${field === "startsAt" ? "開始日時" : "終了日時"}`} type="datetime-local" step="60" value={block[field]} onClick={e => e.currentTarget.showPicker?.()} onChange={e => { const value = e.currentTarget.value; setDraft(items => items.map(item => item.id === block.id ? { ...item, [field]: value } : item)); }} /></span>)}</div>
          </div>)}
          {group[0].kind !== "talk" && <button type="button" onClick={() => edit(() => reflowSchedule(utcDraft().filter(b => b.id !== group[0].id), event.startsAt))}>削除</button>}
        </ScheduleCard>)}</ol>
      </SortableContext>
      <DragOverlay>{activeId && <div className="lt-schedule-overlay">{title(draft.find(b => b.id === activeId)!)}</div>}</DragOverlay>
    </DndContext>
    <div>{(["opening", "break", "closing"] as const).map(kind => <button key={kind} type="button" disabled={kind !== "break" && draft.some(b => b.kind === kind)} onClick={() => add(kind)}>{labels[kind]}を追加</button>)}</div>
    <button type="button" onClick={() => edit(() => reflowSchedule(utcDraft(), event.startsAt))}>時刻を連続配置</button>
    <button type="button" onClick={save}>時間割を保存</button><button type="button" onClick={() => { setDraft(localize(blocks)); setError(""); }}>編集を取り消す</button>
  </fieldset>;
}
