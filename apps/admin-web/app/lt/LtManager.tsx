"use client";
import "./lt.css";
import { canReapprove, canReview, syncTimetableEvent } from "../../lib/lt/operator-state";
import { useEffect, useRef, useState } from "react";
import type { EventSettings, OperatorApplication, EventSettingsPage, OperatorApplicationPage, OperatorTimetable } from "../../../../contracts/lt/v1";

import { TimetableEditor } from "./TimetableEditor";
const root = "/api/lt/v1/operator";
type Task = () => Promise<void>;
class ApiFailure extends Error { constructor(message: string, readonly status: number) { super(message); } }

/** @brief 運営APIの失敗と競合を表示用エラーに変換する @param path APIパス @param method HTTP動詞 @param body ペイロード @returns 応答 */
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(root + path, { method, credentials: "same-origin", cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const names: Record<string, string> = { title: "開催名", venue: "会場", startsAt: "開始日時", timeZone: "タイムゾーン", opensAt: "募集開始", closesAt: "募集終了", capacity: "定員", talkMinutes: "発表時間", transitionMinutes: "転換時間", blocks: "時間割", note: "運営メモ" };
    const fields = Array.isArray(detail?.error?.fields) ? detail.error.fields.map((field: { path?: string }) => names[String(field.path).split(".").pop() ?? ""]).filter(Boolean).join("、") : "";
    throw new ApiFailure(response.status === 409 ? "他の操作で更新されています。再読込して内容を確認してください。" : response.status === 401 ? "ログインが必要です。" : response.status === 403 ? "この操作の権限がありません。" : response.status === 422 ? `入力を確認してください${fields ? `: ${fields}` : ""}` : `操作できませんでした (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

async function fetchEvents(): Promise<EventSettings[]> { const items: EventSettings[] = []; let cursor: string | null = null; do { const page: EventSettingsPage = await api("/events" + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "")); items.push(...page.items); cursor = page.nextCursor; } while (cursor); return items; }

/** @brief 開催設定と申請審査の画面 @returns 運営UI */
export function LtManager() {
  const [needsReload, setNeedsReload] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [creating, setCreating] = useState(false);
  const [timetable, setTimetable] = useState<OperatorTimetable | null>(null);
  const [events, setEvents] = useState<EventSettings[]>([]);
  const [event, setEvent] = useState<EventSettings | null>(null);
  const [applicationCursor, setApplicationCursor] = useState<string | null>(null);
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
    lock.current = true; setBusy(true); setError(""); setMessage(""); retry.current = task; setCanRetry(false);
    try { await task(); retry.current = null; } catch (cause) { if (cause instanceof ApiFailure && [401, 403, 409].includes(cause.status)) setNeedsReload(true); if (cause instanceof ApiFailure && cause.status >= 400 && cause.status < 500) retry.current = null; setError(cause instanceof Error ? cause.message : "操作できませんでした"); }
    finally { lock.current = false; setBusy(false); setCanRetry(retry.current !== null); }
  }
  async function loadEvents() { setEvents(await fetchEvents()); }
  useEffect(() => { let active = true; void fetchEvents().then(items => { if (active) setEvents(items); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "読込に失敗しました"); }); return () => { active = false; }; }, []);

  async function open(item: EventSettings) {
    const [result, schedule, detail] = await Promise.all([api<OperatorApplicationPage>(`/events/${encodeURIComponent(item.id)}/applications`), api<OperatorTimetable>(`/events/${encodeURIComponent(item.id)}/timetable`), api<EventSettings>(`/events/${encodeURIComponent(item.id)}`)]);
    setCancelConfirm(false); setTimetable(schedule);
    setApplicationCursor(result.nextCursor); setEvent(detail); setApplications(result.items); setSelected(null);
  }
  function mutate(path: string, version: number, data: unknown, complete: (result: unknown) => void | Promise<void>, method = "POST") {
    // 再試行でも operationId を維持し、不確かな成功を重複適用しない
    const payload = { expectedVersion: version, operationId: crypto.randomUUID(), data };
    void run(async () => { await complete(await api(path, method, payload)); setMessage("保存しました"); });
  }
  function review(action: string) {
    if (!selected) return;
    const application = selected;
    if (!event || !timetable) return;
    const data = action === "approve" ? { startsAt: new Date(startsAt).toISOString(), expectedEventVersion: event.version, expectedScheduleVersion: timetable.version } : action === "reapprove" ? { expectedEventVersion: event.version } : action === "confirm-withdrawal" ? {} : { note };
    mutate(`/applications/${encodeURIComponent(application.id)}/${action}`, application.version, data, async result => {
      const updated = result as OperatorApplication;
      setSelected(updated); setApplications(items => items.map(item => item.id === updated.id ? updated : item));
      const [currentEvent, currentTimetable] = await Promise.all([api<EventSettings>(`/events/${encodeURIComponent(event.id)}`), api<OperatorTimetable>(`/events/${encodeURIComponent(event.id)}/timetable`)]); setEvent(currentEvent); setTimetable(currentTimetable);
    });
  }
  return <section className="lt-manager" aria-busy={busy}>
    {error && <div role="alert"><p>{error}</p>{canRetry && <button disabled={busy} onClick={() => retry.current && void run(retry.current)}>再試行</button>}<button disabled={busy} onClick={() => void run(async () => { await loadEvents(); setEvent(null); setSelected(null); setNeedsReload(false); })}>再読込</button></div>}
    <p role="status">{busy ? "処理中…" : message}</p>
    <fieldset disabled={busy || needsReload} style={{ border: 0, padding: 0, minWidth: 0 }}>
    {creating ? <div key="create"><button onClick={() => setCreating(false)}>作成を中断</button><h2>開催回を作成</h2><EventForm value={{ id: "", version: 1, state: "scheduled", title: "", venue: "", guidance: "", startsAt: "", timeZone: "", opensAt: "", closesAt: "", capacity: 20, talkMinutes: 10, transitionMinutes: 1 }} onSave={data => { const body = { ...data, operationId: crypto.randomUUID() }; void run(async () => { const created = await api<EventSettings>("/events", "POST", body); await loadEvents(); await open(created); setCreating(false); }); }} /></div> : selected ? <div key="application">
      <button onClick={() => { setSelected(null); setNote(""); setStartsAt(""); }}>申請一覧に戻る</button>
      <h2>{selected.content.title}</h2><p>審査: {selected.review} / 辞退: {selected.withdrawal}</p>
      <p>代表者メール: {selected.representativeEmail}</p><h3>申請原稿</h3><p style={{ whiteSpace: "pre-wrap" }}>{selected.content.abstract}</p><p>{selected.content.description}</p>
      <p>{selected.content.speakers.map(speaker => speaker.displayName).join("、")}</p>
      {/^(https?):\/\//i.test(selected.materialUrl) ? <a href={selected.materialUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">資料を確認</a> : <p>資料URLを確認できません</p>}
      <h3>公開版</h3>{selected.published ? <><p>{selected.published.title}</p><p>{selected.published.abstract}</p><p>{selected.published.startsAt}</p></> : <p>未公開</p>}
      <label>運営メモ<textarea value={note} onInput={e => setNote(e.currentTarget.value)} /></label>
      <label>発表開始日時<input type="datetime-local" value={startsAt} onInput={e => setStartsAt(e.currentTarget.value)} /></label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button disabled={!startsAt || !canReview(selected, "approve")} onClick={() => review("approve")}>承認</button>
      <button disabled={!canReapprove(selected)} onClick={() => review("reapprove")}>再承認</button>
      <button disabled={!canReview(selected, "return")} onClick={() => review("return")}>差し戻し</button><button disabled={!canReview(selected, "hold")} onClick={() => review("hold")}>保留</button>
      <button disabled={!canReview(selected, "reject")} onClick={() => review("reject")}>見送り</button>
      <button disabled={selected.withdrawal !== "requested"} onClick={() => review("confirm-withdrawal")}>辞退確定</button></div>
      <p>代表者メール変更は本人確認フロー未確定のため未対応です。</p>
    </div> : event ? <div key="event">
      <button onClick={() => { setEvent(null); setApplications([]); }}>開催回一覧に戻る</button><h2>{event.title}</h2>
      <EventForm value={event} onSave={value => mutate(`/events/${encodeURIComponent(event.id)}`, event.version, value, result => { const updated = result as EventSettings; setEvent(updated); setEvents(items => items.map(item => item.id === updated.id ? updated : item)); }, "PATCH")} />
      <button onClick={() => mutate(`/events/${encodeURIComponent(event.id)}/copy`, event.version, {}, async result => { await loadEvents(); await open(result as EventSettings); })}>設定をコピー</button>
      <button disabled={event.state === "cancelled"} onClick={() => setCancelConfirm(true)}>開催中止</button>
      {cancelConfirm && <div role="group" aria-label="開催中止の確認"><p>この開催回を中止しますか？</p><button onClick={() => mutate(`/events/${encodeURIComponent(event.id)}/cancel`, event.version, {}, result => { const updated = result as EventSettings; setEvent(updated); setEvents(items => items.map(item => item.id === updated.id ? updated : item)); setCancelConfirm(false); })}>中止を確定</button><button onClick={() => setCancelConfirm(false)}>中止を取り消す</button></div>}
      <h3>申請一覧</h3>{applications.length === 0 && <p>申請はありません</p>}
      <ul>{applications.map(item => <li key={item.id}><button onClick={() => { void run(async () => { const detail = await api<OperatorApplication>(`/applications/${encodeURIComponent(item.id)}`); setSelected(detail); setNote(detail.operatorNote); setStartsAt(""); }); }}>{item.content.title} ({item.review})</button></li>)}</ul>
      {applicationCursor && <button onClick={() => void run(async () => { const page = await api<OperatorApplicationPage>(`/events/${encodeURIComponent(event.id)}/applications?cursor=${encodeURIComponent(applicationCursor)}`); setApplications(items => [...items, ...page.items]); setApplicationCursor(page.nextCursor); })}>申請をさらに表示</button>}
      {timetable && <TimetableEditor key={`${timetable.eventId}:${timetable.version}`} blocks={timetable.blocks} disabled={busy} onSave={blocks => mutate(`/events/${encodeURIComponent(event.id)}/timetable`, timetable.version, { blocks, expectedEventVersion: event.version }, result => { const saved = result as OperatorTimetable; setTimetable(saved); setEvent(current => current ? syncTimetableEvent(current, saved) : current); }, "PUT")} />}
    </div> : <div key="events"><h2>開催回一覧</h2><button onClick={() => setCreating(true)}>開催回を作成</button><ul>{events.map(item => <li key={item.id}><button onClick={() => void run(() => open(item))}>{item.title} ({item.state})</button></li>)}</ul></div>}
    </fieldset>
  </section>;
}

/** @brief 開催設定を編集する @param props 現在値と保存処理 @returns 編集フォーム */
function EventForm({ value, onSave }: { value: EventSettings; onSave: (value: Omit<EventSettings, "id" | "version" | "state">) => void }) {
  const [draft, setDraft] = useState(value);
  const [source, setSource] = useState(value);
  if (source.id !== value.id || source.version !== value.version) { setSource(value); setDraft(value); }

  return <form onSubmit={e => { e.preventDefault(); const data = { title: draft.title, venue: draft.venue, guidance: draft.guidance, startsAt: draft.startsAt, timeZone: draft.timeZone, opensAt: draft.opensAt, closesAt: draft.closesAt, capacity: draft.capacity, talkMinutes: draft.talkMinutes, transitionMinutes: draft.transitionMinutes }; const valid = [data.startsAt, data.opensAt, data.closesAt].every(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))); if (!valid || Date.parse(data.opensAt) >= Date.parse(data.closesAt)) { window.alert("UTC日時と募集開始・終了の順序を確認してください"); return; } onSave(data); }}>
    {(["title", "venue", "guidance", "startsAt", "timeZone", "opensAt", "closesAt"] as const).map(key => <label key={key} style={{ display: "block" }}>{({ title: "開催名", venue: "会場", guidance: "案内", startsAt: "開始日時 (UTC)", timeZone: "タイムゾーン", opensAt: "募集開始 (UTC)", closesAt: "募集終了 (UTC)" })[key]}<input required={key !== "guidance"} value={draft[key]} onInput={e => setDraft({ ...draft, [key]: e.currentTarget.value })} /></label>)}
    {(["capacity", "talkMinutes", "transitionMinutes"] as const).map(key => <label key={key} style={{ display: "block" }}>{({ capacity: "定員", talkMinutes: "発表時間 (分)", transitionMinutes: "転換時間 (分)" })[key]}<input type="number" min={key === "transitionMinutes" ? 0 : 1} required value={draft[key]} onInput={e => setDraft({ ...draft, [key]: Number(e.currentTarget.value) })} /></label>)}
    <button>設定を保存</button><button type="button" onClick={() => setDraft(value)}>編集を取り消す</button>
  </form>;
}
