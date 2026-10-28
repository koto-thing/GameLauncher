"use client";
import { useState, useRef, useEffect } from "react";
import type { EventSettings } from "../../../../contracts/lt/v1";
import { scheduleCapacity } from "../../lib/lt/schedule-rules";
import { localEventTime, utcEventTime } from "../../lib/lt/event-time";

const dates = ["startsAt", "opensAt", "closesAt"] as const;
const dateLabels = { startsAt: "開始日時", opensAt: "募集開始日時", closesAt: "募集終了日時" };

/**
 * 保存設定から現地日時の入力状態を作る
 * @param value 保存済みの開催設定
 * @returns 編集用の日時と時間割設定
 */
function editable(value: EventSettings) {
  const timeZone = value.timeZone || "Asia/Tokyo";
  return { ...value, timeZone, endsBy: value.endsBy ? localEventTime(value.endsBy, timeZone) : "", startsAt: localEventTime(value.startsAt, timeZone), opensAt: localEventTime(value.opensAt, timeZone), closesAt: localEventTime(value.closesAt, timeZone) };
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


  // 表示中の地域日時をUTCへ変換し、終了上限から定員を即時表示する
  let computedCapacity = draft.capacity;
  try {
    if (draft.scheduleMode === "automatic" && draft.endsBy)
      computedCapacity = scheduleCapacity({ ...draft, startsAt: utcEventTime(draft.startsAt, draft.timeZone, value.startsAt), endsBy: utcEventTime(draft.endsBy, draft.timeZone, value.endsBy ?? "") });
  } catch { computedCapacity = 0; }

  const zones = Array.from(new Set(["Asia/Tokyo", "UTC", draft.timeZone, ...Intl.supportedValuesOf("timeZone")]));

  return <form className="lt-event-form" onSubmit={e => {
    e.preventDefault();
    if (uploading) return;
    try {
      const startsAt = utcEventTime(draft.startsAt, draft.timeZone, value.startsAt);
      const opensAt = draft.planning?.relativeRecruitment ? new Date(Date.parse(startsAt) - draft.planning.opensDaysBefore * 86400000).toISOString() : utcEventTime(draft.opensAt, draft.timeZone, value.opensAt);
      const closesAt = draft.planning?.relativeRecruitment ? new Date(Date.parse(startsAt) - draft.planning.closesDaysBefore * 86400000).toISOString() : utcEventTime(draft.closesAt, draft.timeZone, value.closesAt);
      if (Date.parse(opensAt) >= Date.parse(closesAt)) { setError("募集終了日時は募集開始日時より後にしてください"); return; }
      const endsBy = draft.scheduleMode === "automatic" && draft.endsBy ? utcEventTime(draft.endsBy, draft.timeZone, value.endsBy ?? "") : null;
      if (endsBy && computedCapacity < 1) { setError("終了上限までに発表を1件も配置できません。終了上限か時間割ルールを調整してください。"); return; }
      setError("");
      onSave({ title: draft.title, venue: draft.venue, guidance: draft.guidance, ...(draft.posterUrl?.trim() ? { posterUrl: draft.posterUrl.trim() } : {}), timeZone: draft.timeZone, startsAt, opensAt, closesAt, approvalMode: draft.approvalMode, scheduleMode: draft.scheduleMode, openingMinutes: draft.openingMinutes, breakEvery: draft.breakEvery, breakMinutes: draft.breakMinutes, closingMinutes: draft.closingMinutes, endsBy, ...(draft.planning ? { planning: draft.planning } : {}), capacity: computedCapacity, talkMinutes: draft.talkMinutes, transitionMinutes: draft.transitionMinutes });
    } catch { setError("日時を確認してください。夏時間の切替で存在しない時刻・重複する時刻は指定できません"); }
  }}>
    <label>承認方式<select value={draft.approvalMode} onChange={e => setDraft({ ...draft, approvalMode: e.currentTarget.value as EventSettings["approvalMode"] })}><option value="automatic">自動承認</option><option value="manual">手動承認</option></select><small>自動承認では初回申請を即時公開し、発表時刻を割り当てます。差し戻し後の再提出と、切替前の審査待ちは手動確認です。</small></label>
    <label>時間割方式<select value={draft.scheduleMode} onChange={e => setDraft({ ...draft, scheduleMode: e.currentTarget.value as EventSettings["scheduleMode"], endsBy: e.currentTarget.value === "manual" ? "" : draft.endsBy })}><option value="automatic">ルールから自動生成</option><option value="manual">手動で時間割を編集</option></select></label>
    {draft.scheduleMode === "automatic" && <fieldset><legend>時間割ルール</legend>
      {(["openingMinutes", "breakEvery", "breakMinutes", "closingMinutes"] as const).map(key => <label key={key}>{({ openingMinutes: "開会 (分)", breakEvery: "何発表ごとに休憩するか", breakMinutes: "休憩 (分)", closingMinutes: "閉会 (分)" })[key]}<input type="number" required min={key === "breakEvery" ? 1 : 0} max={key === "breakEvery" ? 10000 : 1440} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: Number(e.currentTarget.value) })} /></label>)}
      <label>終了上限<input type="datetime-local" step="60" value={draft.endsBy} onChange={e => setDraft({ ...draft, endsBy: e.currentTarget.value })} /><small>指定すると募集可能数を自動計算します。超過時は受付や設定変更を止め、発表時間は短縮しません。</small></label>
      <p>募集可能数: {computedCapacity}件</p>
    </fieldset>}
    <label>開催名<input required value={draft.title} onChange={e => setDraft({ ...draft, title: e.currentTarget.value })} /></label>
    <label>会場<input required value={draft.venue} onChange={e => setDraft({ ...draft, venue: e.currentTarget.value })} /></label>
    <label>案内<textarea rows={4} value={draft.guidance} onChange={e => setDraft({ ...draft, guidance: e.currentTarget.value })} /></label>
    <label>ポスター画像<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void uploadPoster(file); }} /><small>PNG・JPEG・WebP／5MBまで。選択後、「設定を保存」で公開します。</small>{uploading && <span role="status">アップロード中…</span>}</label>
    {draft.posterUrl?.startsWith("https://") && <div className="lt-event-poster"><img src={draft.posterUrl} alt="ポスターのプレビュー" referrerPolicy="no-referrer" /><button type="button" disabled={uploading} onClick={() => setDraft({ ...draft, posterUrl: undefined })}>ポスターを削除</button></div>}
    <label>タイムゾーン<select value={draft.timeZone} onChange={e => setDraft({ ...draft, timeZone: e.currentTarget.value })}>{zones.map(zone => <option key={zone} value={zone}>{zone === "Asia/Tokyo" ? "日本標準時（東京・UTC+09:00）" : zone === "UTC" ? "協定世界時（UTC）" : zone}</option>)}</select><small>以下の日時は選択した地域の時刻です</small></label>
    {dates.map(key => <label key={key}>{dateLabels[key]}<input type="datetime-local" required={key === "startsAt" || !draft.planning?.relativeRecruitment} disabled={key !== "startsAt" && draft.planning?.relativeRecruitment} step="60" value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.currentTarget.value })} onClick={e => { if (e.currentTarget.showPicker) e.currentTarget.showPicker(); }} /></label>)}
    {(["capacity", "talkMinutes", "transitionMinutes"] as const).map(key => <label key={key}>{({ capacity: "定員", talkMinutes: "発表時間 (分)", transitionMinutes: "転換時間 (分)" })[key]}<input type="number" min={key === "transitionMinutes" ? 0 : 1} required disabled={key === "capacity" && draft.scheduleMode === "automatic" && !!draft.endsBy} value={key === "capacity" ? computedCapacity : draft[key]} onChange={e => setDraft({ ...draft, [key]: Number(e.currentTarget.value) })} /></label>)}
    <fieldset><legend>開催日から逆算する運営ルール</legend>
      <label><input type="checkbox" checked={!!draft.planning} onChange={e => setDraft({ ...draft, planning: e.currentTarget.checked ? { relativeRecruitment: true, opensDaysBefore: 28, closesDaysBefore: 7, materialDaysBefore: 3, reminderDaysBefore: 1 } : undefined })} />相対締切・資料リマインドを使用</label>
      {draft.planning && <><p>1日は24時間として開催開始から逆算します。設定のコピーにも引き継がれます。</p>
        <label><input type="checkbox" checked={draft.planning.relativeRecruitment} onChange={e => setDraft({ ...draft, planning: { ...draft.planning!, relativeRecruitment: e.currentTarget.checked } })} />募集期間も開催日から逆算</label>
        {(["opensDaysBefore", "closesDaysBefore", "materialDaysBefore", "reminderDaysBefore"] as const).map(key => <label key={key}>{({ opensDaysBefore: "募集開始（開催の何日前）", closesDaysBefore: "募集終了（開催の何日前）", materialDaysBefore: "資料提出期限（開催の何日前）", reminderDaysBefore: "案内（資料期限の何日前）" })[key]}<input type="number" min="0" max="365" required value={draft.planning![key]} onChange={e => setDraft({ ...draft, planning: { ...draft.planning!, [key]: Number(e.currentTarget.value) } })} /></label>)}
        <p>未提出・未確認の申請へ期限前に1回案内します。提出済みの資料は運営側で確認済みにしてください。</p>
      </>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <button disabled={uploading}>設定を保存</button><button type="button" disabled={uploading} onClick={() => { setDraft(editable(value)); setError(""); }}>編集を取り消す</button>
  </form>;
}
