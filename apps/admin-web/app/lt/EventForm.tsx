"use client";
import { useState } from "react";
import type { EventSettings } from "../../../../contracts/lt/v1";
import { localEventTime, utcEventTime } from "../../lib/lt/event-time";

const dates = ["startsAt", "opensAt", "closesAt"] as const;
const dateLabels = { startsAt: "開始日時", opensAt: "募集開始日時", closesAt: "募集終了日時" };

/** @brief 保存設定から現地日時の入力状態を作る @param value 保存設定 @returns 入力状態 */
function editable(value: EventSettings) {
  const timeZone = value.timeZone || "Asia/Tokyo";
  return { ...value, timeZone, startsAt: localEventTime(value.startsAt, timeZone), opensAt: localEventTime(value.opensAt, timeZone), closesAt: localEventTime(value.closesAt, timeZone) };
}

/** @brief 地域を選んでカレンダーから開催日時を設定する @param props 設定と保存処理 @returns 開催設定フォーム */
export function EventForm({ value, onSave }: { value: EventSettings; onSave: (value: Omit<EventSettings, "id" | "version" | "state" | "publishEnabled">) => void }) {
  const [draft, setDraft] = useState(() => editable(value));
  const [source, setSource] = useState(value);
  const [error, setError] = useState("");
  if (source.id !== value.id || source.version !== value.version) { setSource(value); setDraft(editable(value)); setError(""); }
  const zones = Array.from(new Set(["Asia/Tokyo", "UTC", draft.timeZone, ...Intl.supportedValuesOf("timeZone")]));

  return <form className="lt-event-form" onSubmit={e => {
    e.preventDefault();
    try {
      const startsAt = utcEventTime(draft.startsAt, draft.timeZone, value.startsAt);
      const opensAt = utcEventTime(draft.opensAt, draft.timeZone, value.opensAt);
      const closesAt = utcEventTime(draft.closesAt, draft.timeZone, value.closesAt);
      if (Date.parse(opensAt) >= Date.parse(closesAt)) { setError("募集終了日時は募集開始日時より後にしてください"); return; }
      setError("");
      onSave({ title: draft.title, venue: draft.venue, guidance: draft.guidance, ...(draft.posterUrl?.trim() ? { posterUrl: draft.posterUrl.trim() } : {}), timeZone: draft.timeZone, startsAt, opensAt, closesAt, capacity: draft.capacity, talkMinutes: draft.talkMinutes, transitionMinutes: draft.transitionMinutes });
    } catch { setError("日時を確認してください。夏時間の切替で存在しない時刻・重複する時刻は指定できません"); }
  }}>
    <label>開催名<input required value={draft.title} onChange={e => setDraft({ ...draft, title: e.currentTarget.value })} /></label>
    <label>会場<input required value={draft.venue} onChange={e => setDraft({ ...draft, venue: e.currentTarget.value })} /></label>
    <label>案内<textarea rows={4} value={draft.guidance} onChange={e => setDraft({ ...draft, guidance: e.currentTarget.value })} /></label>
    <label>ポスター画像URL<input type="url" pattern="https://.*" maxLength={2048} placeholder="https://…/poster.png" value={draft.posterUrl ?? ""} onChange={e => setDraft({ ...draft, posterUrl: e.currentTarget.value })} /></label>
    {draft.posterUrl?.startsWith("https://") && <div className="lt-event-poster"><img src={draft.posterUrl} alt="ポスターのプレビュー" referrerPolicy="no-referrer" /><button type="button" onClick={() => setDraft({ ...draft, posterUrl: undefined })}>ポスターを削除</button></div>}
    <label>タイムゾーン<select value={draft.timeZone} onChange={e => setDraft({ ...draft, timeZone: e.currentTarget.value })}>{zones.map(zone => <option key={zone} value={zone}>{zone === "Asia/Tokyo" ? "日本標準時（東京・UTC+09:00）" : zone === "UTC" ? "協定世界時（UTC）" : zone}</option>)}</select><small>以下の日時は選択した地域の時刻です</small></label>
    {dates.map(key => <label key={key}>{dateLabels[key]}<input type="datetime-local" required step="60" value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.currentTarget.value })} onClick={e => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }} /></label>)}
    {(["capacity", "talkMinutes", "transitionMinutes"] as const).map(key => <label key={key}>{({ capacity: "定員", talkMinutes: "発表時間 (分)", transitionMinutes: "転換時間 (分)" })[key]}<input type="number" min={key === "transitionMinutes" ? 0 : 1} required value={draft[key]} onChange={e => setDraft({ ...draft, [key]: Number(e.currentTarget.value) })} /></label>)}
    {error && <p role="alert">{error}</p>}
    <button>設定を保存</button><button type="button" onClick={() => { setDraft(editable(value)); setError(""); }}>編集を取り消す</button>
  </form>;
}
