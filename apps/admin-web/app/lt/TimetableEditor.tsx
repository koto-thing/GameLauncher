"use client";
import { useState } from "react";
import type { ScheduleBlock } from "../../../../contracts/lt/v1";

/** @brief 順序と開会・休憩・閉会を編集する @param props 読込済み時間割と保存処理 @returns 時間割編集 */
export function TimetableEditor({ blocks, onSave, disabled }: { blocks: ScheduleBlock[]; onSave: (blocks: ScheduleBlock[]) => void; disabled: boolean }) {
  const [draft, setDraft] = useState(blocks);
  const [error, setError] = useState("");
  function move(index: number, offset: number) {
    const next = [...draft];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setDraft(next);
  }
  function save() {
    if (draft.some(block => !Number.isFinite(Date.parse(block.startsAt)) || !Number.isFinite(Date.parse(block.endsAt)) || Date.parse(block.startsAt) >= Date.parse(block.endsAt))) { setError("各項目の開始・終了日時を確認してください"); return; }
    if (draft.some((block, index) => index > 0 && Date.parse(block.startsAt) < Date.parse(draft[index - 1].endsAt))) { setError("時間が重複しているか順序と一致しません"); return; }
    setError(""); onSave(draft);
  }
  return <fieldset disabled={disabled}><legend>時間割</legend>
    {error && <p role="alert">{error}</p>}
    <ol>{draft.map((block, index) => <li key={block.id}>
      <p>{({ talk: "発表", transition: "転換", opening: "開会", break: "休憩", closing: "閉会" })[block.kind]} {block.talkId}</p>
      <label>開始 (UTC)<input value={block.startsAt} onChange={e => setDraft(items => items.map(item => item.id === block.id ? { ...item, startsAt: e.target.value } : item))} /></label>
      <label>終了 (UTC)<input value={block.endsAt} onChange={e => setDraft(items => items.map(item => item.id === block.id ? { ...item, endsAt: e.target.value } : item))} /></label>
      <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>上へ</button><button type="button" disabled={index === draft.length - 1} onClick={() => move(index, 1)}>下へ</button>
      {block.kind !== "talk" && <button type="button" onClick={() => setDraft(items => items.filter(item => item.id !== block.id))}>削除</button>}
    </li>)}</ol>
    {(["opening", "break", "closing"] as const).map(kind => <button key={kind} type="button" onClick={() => setDraft(items => [...items, { id: crypto.randomUUID(), kind, startsAt: "", endsAt: "" }])}>{({ opening: "開会", break: "休憩", closing: "閉会" })[kind]}を追加</button>)}
    <button type="button" onClick={save}>時間割を保存</button><button type="button" onClick={() => { setDraft(blocks); setError(""); }}>編集を取り消す</button>
  </fieldset>;
}
