"use client";
import { useState, useRef, useEffect } from "react";
import type { EventSettings } from "../../../../contracts/lt/v1";
import { localEventTime, utcEventTime } from "../../lib/lt/event-time";

const dates = ["startsAt", "opensAt", "closesAt"] as const;
const dateLabels = { startsAt: "開始日時", opensAt: "募集開始日時", closesAt: "募集終了日時" };

/** @brief 保存設定から現地日時の入力状態を作る @param value 保存設定 @returns 入力状態 */
function editable(value: EventSettings) {
  const timeZone = value.timeZone || "Asia/Tokyo";
  return { ...value, timeZone, startsAt: localEventTime(value.startsAt, timeZone), opensAt: localEventTime(value.opensAt, timeZone), closesAt: localEventTime(value.closesAt, timeZone) };
}

/**
 * 開催日時と承認方式を編集する
 *
 * @param props 開催設定フォームの入力
 * @param props.value 現在の開催設定
 * @param props.onSave 編集した設定を保存する処理
 * @returns 編集画面のReact要素
 */
export function EventForm({ value, onSave }: { value: EventSettings; onSave: (value: Omit<EventSettings, "id" | "version" | "state" | "publishEnabled">) => void }) {
  const [draft, setDraft] = useState(() => editable(value));
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadGeneration = useRef(0);

  // 開催回の切り替えやアンマウント後のアップロード結果を破棄する
  useEffect(() => () => { uploadGeneration.current++; }, []);

  // 選択画像の形式と容量を確認してアップロードする
  async function uploadPoster(file: File) {
    const generation = ++uploadGeneration.current;
    setError("");
    setUploading(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("画像は5MB以下にしてください");
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("PNG・JPEG・WebPの画像を選択してください");
      const image = await createImageBitmap(file);
      const tooLarge = image.width * image.height > 40000000;
      image.close();
      if (tooLarge) throw new Error("画像は4,000万画素以下にしてください");
      const response = await fetch("/api/lt/posters", {method:"POST",headers:{"Content-Type":file.type},body:file});
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json() as {url:string};
      if (generation === uploadGeneration.current) setDraft(current => ({...current,posterUrl:result.url}));
    } catch (cause) {
      if (generation === uploadGeneration.current) setError(cause instanceof Error ? cause.message : "画像をアップロードできませんでした");
    } finally {
      if (generation === uploadGeneration.current) setUploading(false);
    }
  }


  const zones = Array.from(new Set(["Asia/Tokyo", "UTC", draft.timeZone, ...Intl.supportedValuesOf("timeZone")]));

  return <form className="lt-event-form" onSubmit={e => {
    e.preventDefault();
    if (uploading) return;
    try {
      const startsAt = utcEventTime(draft.startsAt, draft.timeZone, value.startsAt);
      const opensAt = utcEventTime(draft.opensAt, draft.timeZone, value.opensAt);
      const closesAt = utcEventTime(draft.closesAt, draft.timeZone, value.closesAt);
      if (Date.parse(opensAt) >= Date.parse(closesAt)) { setError("募集終了日時は募集開始日時より後にしてください"); return; }
      setError("");
      onSave({ title: draft.title, venue: draft.venue, guidance: draft.guidance, ...(draft.posterUrl?.trim() ? { posterUrl: draft.posterUrl.trim() } : {}), timeZone: draft.timeZone, startsAt, opensAt, closesAt, approvalMode: draft.approvalMode, capacity: draft.capacity, talkMinutes: draft.talkMinutes, transitionMinutes: draft.transitionMinutes });
    } catch { setError("日時を確認してください。夏時間の切替で存在しない時刻・重複する時刻は指定できません"); }
  }}>
    <label>承認方式<select value={draft.approvalMode} onChange={e => setDraft({ ...draft, approvalMode: e.currentTarget.value as EventSettings["approvalMode"] })}><option value="automatic">自動承認</option><option value="manual">手動承認</option></select><small>自動承認では初回申請を即時公開し、発表時刻を割り当てます。差し戻し後の再提出と、切替前の審査待ちは手動確認です。</small></label>
    <label>開催名<input required value={draft.title} onChange={e => setDraft({ ...draft, title: e.currentTarget.value })} /></label>
    <label>会場<input required value={draft.venue} onChange={e => setDraft({ ...draft, venue: e.currentTarget.value })} /></label>
    <label>案内<textarea rows={4} value={draft.guidance} onChange={e => setDraft({ ...draft, guidance: e.currentTarget.value })} /></label>
    <label>ポスター画像<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void uploadPoster(file); }} /><small>PNG・JPEG・WebP／5MBまで。選択後、「設定を保存」で公開します。</small>{uploading && <span role="status">アップロード中…</span>}</label>
    {draft.posterUrl?.startsWith("https://") && <div className="lt-event-poster"><img src={draft.posterUrl} alt="ポスターのプレビュー" referrerPolicy="no-referrer" /><button type="button" disabled={uploading} onClick={() => setDraft({ ...draft, posterUrl: undefined })}>ポスターを削除</button></div>}
    <label>タイムゾーン<select value={draft.timeZone} onChange={e => setDraft({ ...draft, timeZone: e.currentTarget.value })}>{zones.map(zone => <option key={zone} value={zone}>{zone === "Asia/Tokyo" ? "日本標準時（東京・UTC+09:00）" : zone === "UTC" ? "協定世界時（UTC）" : zone}</option>)}</select><small>以下の日時は選択した地域の時刻です</small></label>
    {dates.map(key => <label key={key}>{dateLabels[key]}<input type="datetime-local" required step="60" value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.currentTarget.value })} onClick={e => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }} /></label>)}
    {(["capacity", "talkMinutes", "transitionMinutes"] as const).map(key => <label key={key}>{({ capacity: "定員", talkMinutes: "発表時間 (分)", transitionMinutes: "転換時間 (分)" })[key]}<input type="number" min={key === "transitionMinutes" ? 0 : 1} required value={draft[key]} onChange={e => setDraft({ ...draft, [key]: Number(e.currentTarget.value) })} /></label>)}
    {error && <p role="alert">{error}</p>}
    <button disabled={uploading}>設定を保存</button><button type="button" disabled={uploading} onClick={() => { setDraft(editable(value)); setError(""); }}>編集を取り消す</button>
  </form>;
}
