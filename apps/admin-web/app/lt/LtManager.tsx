"use client";
import { useEffect, useRef, useState } from "react";
import type { EventSettings, OperatorApplication, Page } from "../../../../contracts/lt/v1";

const root = "/api/lt/v1/operator";
type Task = () => Promise<void>;

/** @brief 運営APIの失敗と競合を表示用エラーに変換する @param path APIパス @param method HTTP動詞 @param body ペイロード @returns 応答 */
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(root + path, { method, credentials: "same-origin", cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(response.status === 409 ? "他の操作で更新されています。再読込して内容を確認してください。" : response.status === 401 ? "ログインが必要です。" : response.status === 403 ? "この操作の権限がありません。" : `操作できませんでした (${response.status})`);
  return response.json() as Promise<T>;
}

/** @brief 開催設定と申請審査の画面 @returns 運営UI */
export function LtManager() {
  const [events, setEvents] = useState<EventSettings[]>([]);
  const [event, setEvent] = useState<EventSettings | null>(null);
  const [applications, setApplications] = useState<OperatorApplication[]>([]);
  const [selected, setSelected] = useState<OperatorApplication | null>(null);
  const [note, setNote] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const retry = useRef<Task | null>(null);

  // 同じ操作の二重送信を同期的に止める
  async function run(task: Task) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage(""); retry.current = task;
    try { await task(); retry.current = null; } catch (cause) { setError(cause instanceof Error ? cause.message : "操作できませんでした"); }
    finally { lock.current = false; setBusy(false); }
  }
  async function loadEvents() { setEvents((await api<Page<EventSettings>>("/events")).items); }
  useEffect(result => { setEvent(result as EventSettings); setApplications([]); }, []);

  async function open(item: EventSettings) {
    const result = await api<Page<OperatorApplication>>(`/events/${encodeURIComponent(item.id)}/applications`);
    setEvent(item); setApplications(result.items); setSelected(null);
  }
  function mutate(path: string, version: number, data: unknown, complete: (result: unknown) => void, method = "POST") {
    // 再試行でも operationId を維持し、不確かな成功を重複適用しない
    const payload = { expectedVersion: version, operationId: crypto.randomUUID(), data };
    void run(async () => { complete(await api(path, method, payload)); setMessage("保存しました"); });
  }
  function review(action: string) {
    if (!selected) return;
    const application = selected;
    mutate(`/applications/${encodeURIComponent(application.id)}/${action}`, application.version, { note, ...(startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}) }, result => {
      const updated = result as OperatorApplication;
      setSelected(updated); setApplications(items => items.map(item => item.id === updated.id ? updated : item));
    });
  }
  return <section aria-busy={busy}>
    {error && <div role="alert"><p>{error}</p><button disabled={busy} onClick={() => retry.current && void run(retry.current)}>再試行</button><button disabled={busy} onClick={() => void run(async () => { await loadEvents(); setEvent(null); setSelected(null); })}>再読込</button></div>}
    <p role="status">{busy ? "処理中…" : message}</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
    {selected ? <>
      <button onClick={() => { setSelected(null); setNote(""); setStartsAt(""); }}>申請一覧に戻る</button>
      <h2>{selected.content.title}</h2><p>審査: {selected.review} / 辞退: {selected.withdrawal}</p>
      <h3>申請原稿</h3><p style={{ whiteSpace: "pre-wrap" }}>{selected.content.abstract}</p><p>{selected.content.description}</p>
      <p>{selected.content.speakers.map(speaker => speaker.displayName).join("、")}</p>
      {/^(https?):\/\//i.test(selected.materialUrl) ? <a href={selected.materialUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">資料を確認</a> : <p>資料URLを確認できません</p>}
      <h3>公開版</h3>{selected.published ? <><p>{selected.published.title}</p><p>{selected.published.abstract}</p><p>{selected.published.startsAt}</p></> : <p>未公開</p>}
      <label>運営メモ<textarea value={note} onChange={e => setNote(e.target.value)} /></label>
      <label>発表開始日時<input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} /></label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button disabled={!startsAt || selected.everApproved} onClick={() => review("approve")}>承認</button>
      <button disabled={!selected.everApproved || !["returned", "resubmitted"].includes(selected.review)} onClick={() => review("reapprove")}>再承認</button>
      <button onClick={() => review("return")}>差し戻し</button><button onClick={() => review("hold")}>保留</button>
      <button disabled={selected.everApproved} onClick={() => review("reject")}>見送り</button>
      <button disabled={selected.withdrawal !== "requested"} onClick={() => review("confirm-withdrawal")}>辞退確定</button></div>
      <p>代表者メール変更は本人確認フロー未確定のため未対応です。</p>
    </> : event ? <>
      <button onClick={() => { setEvent(null); setApplications([]); }}>開催回一覧に戻る</button><h2>{event.title}</h2>
      <EventForm value={event} onSave={value => mutate(`/events/${encodeURIComponent(event.id)}`, event.version, value, result => setEvent(result as EventSettings), "PATCH")} />
      <button onClick={() => mutate(`/events/${encodeURIComponent(event.id)}/copy`, event.version, {}, result => { setEvent(result as EventSettings); setApplications([]); })}>設定をコピー</button>
      <button disabled={event.state === "cancelled"} onClick={() => { if (window.confirm("この開催回を中止しますか？")) mutate(`/events/${encodeURIComponent(event.id)}/cancel`, event.version, {}, result => setEvent(result as EventSettings)); }}>開催中止</button>
      <h3>申請一覧</h3>{applications.length === 0 && <p>申請はありません</p>}
      <ul>{applications.map(item => <li key={item.id}><button onClick={() => { setSelected(item); setNote(item.operatorNote); setStartsAt(""); }}>{item.content.title} ({item.review})</button></li>)}</ul>
      <p>時間割は契約追補後に接続します。</p>
    </> : <><h2>開催回一覧</h2><ul>{events.map(item => <li key={item.id}><button onClick={() => void run(() => open(item))}>{item.title} ({item.state})</button></li>)}</ul></>}
    </fieldset>
  </section>;
}

/** @brief 開催設定を編集する @param props 現在値と保存処理 @returns 編集フォーム */
function EventForm({ value, onSave }: { value: EventSettings; onSave: (value: Omit<EventSettings, "id" | "version" | "state">) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <form onSubmit={e => { e.preventDefault(); const { id, version, state, ...data } = draft; onSave(data); }}>
    {(["title", "venue", "guidance", "startsAt", "timeZone", "opensAt", "closesAt"] as const).map(key => <label key={key} style={{ display: "block" }}>{({ title: "開催名", venue: "会場", guidance: "案内", startsAt: "開始日時 (UTC)", timeZone: "タイムゾーン", opensAt: "募集開始 (UTC)", closesAt: "募集終了 (UTC)" })[key]}<input required value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
    {(["capacity", "talkMinutes", "transitionMinutes"] as const).map(key => <label key={key} style={{ display: "block" }}>{({ capacity: "定員", talkMinutes: "発表時間 (分)", transitionMinutes: "転換時間 (分)" })[key]}<input type="number" min={key === "transitionMinutes" ? 0 : 1} required value={draft[key]} onChange={e => setDraft({ ...draft, [key]: Number(e.target.value) })} /></label>)}
    <button>設定を保存</button><button type="button" onClick={() => setDraft(value)}>編集を取り消す</button>
  </form>;
}

