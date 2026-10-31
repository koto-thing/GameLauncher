"use client";
import "./lt.css";
import { OperationsMonitor } from "./OperationsMonitor";
import { LayoutDashboard, ListChecks, CalendarClock, Settings, ShieldAlert, CalendarDays, Plus, ArrowLeft, Users, CircleCheck, Clock, UserMinus } from "lucide-react";
import { EmailChangePanel } from "./EmailChangePanel";
import { canReapprove, canReview, syncTimetableEvent } from "../../lib/lt/operator-state";
import { useEffect, useRef, useState } from "react";
import type { EventSettings, OperatorApplication, EventSettingsPage, OperatorApplicationPage, OperatorTimetable } from "../../../../contracts/lt/v1";

import { SessionFacts, SpeakerLinks } from "../../../lt-web/src/SessionFacts";
import { SessionEditor } from "./SessionEditor";
import { EventForm } from "./EventForm";
import { actionItems } from "../../lib/lt/action-items";
import { canChangeTitle } from "../../../../contracts/lt/application-policy";
import { TimetableEditor } from "./TimetableEditor";
const root = "/api/lt/v1/operator";
type EventView = "overview" | "applications" | "timetable" | "settings" | "exceptions";
const eventViews = [
  { id: "overview", label: "概要", icon: LayoutDashboard },
  { id: "applications", label: "登壇申請", icon: ListChecks },
  { id: "timetable", label: "タイムテーブル", icon: CalendarClock },
  { id: "settings", label: "開催回設定", icon: Settings },
  { id: "exceptions", label: "例外対応", icon: ShieldAlert },
] as const;
type Task = () => Promise<void>;
class ApiFailure extends Error {
  /**
   * APIのエラー内容と再読込の判断に使う情報を保持する
   * @param message 利用者向けの説明
   * @param status HTTPステータス
   * @param code APIのエラーコード
   * @returns エラーインスタンス
   */
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

/**
 * 運営APIの失敗と競合を表示用エラーに変換する
 * @param path APIパス
 * @param method HTTP動詞
 * @param body 送信するペイロード
 * @returns APIの応答
 * @throws APIが失敗した場合の表示用エラー
 */
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(root + path, { method, credentials: "same-origin", cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const names: Record<string, string> = { title: "開催名", venue: "会場", startsAt: "開始日時", timeZone: "タイムゾーン", opensAt: "募集開始", closesAt: "募集終了", capacity: "定員", talkMinutes: "発表時間", transitionMinutes: "転換時間", blocks: "時間割", note: "運営メモ" };
    const fields = Array.isArray(detail?.error?.fields) ? detail.error.fields.map((field: { path?: string }) => names[String(field.path).split(".").pop() ?? ""]).filter(Boolean).join("、") : "";
    throw new ApiFailure(detail?.error?.code === "FIXED_CONFLICT" ? "固定枠が移動・削除されるため確定できません。固定枠と直前の発表時間を確認し、必要なら固定を解除して保存してください。" : detail?.error?.code === "SCHEDULE_FULL" ? "終了上限を超えるため保存・受付できません。終了上限、発表時間、休憩の設定を調整してください。" : detail?.error?.code === "CAPACITY_FULL" ? "登壇枠が満員、または予約済み件数より定員が少なくなっています。定員と申請状況を確認してください。" : detail?.error?.code === "INVALID_TRANSITION" ? "現在の開催・申請状態では操作できません。開始後の時間割設定変更や、コピーした開催回の募集日時を確認してください。" : response.status === 409 ? "他の操作で更新されています。再読込して内容を確認してください。" : response.status === 401 ? "ログインが必要です。" : response.status === 403 ? "この操作の権限がありません。" : response.status === 422 ? `入力を確認してください${fields ? `: ${fields}` : ""}` : `操作できませんでした (${response.status})`, response.status, detail?.error?.code);
  }
  return response.json() as Promise<T>;
}

async function fetchEvents(): Promise<EventSettings[]> { const items: EventSettings[] = []; let cursor: string | null = null; do { const page: EventSettingsPage = await api("/events" + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "")); items.push(...page.items); cursor = page.nextCursor; } while (cursor); return items; }

/**
 * 要対応一覧に未読の申請を残さないよう全ページを取得する
 * @param eventId 対象開催回のID
 * @returns 受付順の全申請
 */
async function fetchApplications(eventId: string): Promise<OperatorApplicationPage> {
  const items: OperatorApplication[] = [];
  let cursor: string | null = null;
  do {
    const page: OperatorApplicationPage = await api(`/events/${encodeURIComponent(eventId)}/applications?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return { items, nextCursor: null };
}

/**
 * 開催回と申請・時間割を管理する
 *
 * @returns 編集画面のReact要素
 */
export function LtManager() {
  const [view, setView] = useState<EventView>("overview");
  const [needsReload, setNeedsReload] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [creating, setCreating] = useState(false);
  const [timetable, setTimetable] = useState<OperatorTimetable | null>(null);
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

  /**
   * 二重送信を止め、失敗の種類に応じて再読込や再試行を案内する
   * @param task 実行する非同期操作
   * @returns 操作の完了を示すPromise
   */
  async function run(task: Task) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage(""); retry.current = task; setCanRetry(false);
    try { await task(); retry.current = null; } catch (cause) { if (cause instanceof ApiFailure && ([401, 403].includes(cause.status) || cause.code === "VERSION_CONFLICT")) setNeedsReload(true); if (cause instanceof ApiFailure && cause.status >= 400 && cause.status < 500) retry.current = null; setError(cause instanceof Error ? cause.message : "操作できませんでした"); }
    finally { lock.current = false; setBusy(false); setCanRetry(retry.current !== null); }
  }
  async function loadEvents() { setEvents(await fetchEvents()); }
  useEffect(() => { let active = true; void fetchEvents().then(items => { if (active) setEvents(items); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "読込に失敗しました"); }); return () => { active = false; }; }, []);

  /**
   * 開催回の最新情報を取得し、別の開催回では概要を表示する
   * @param item 開く開催回
   * @returns 読み込みの完了を示すPromise
   */
  async function open(item: EventSettings) {
    const [result, schedule, detail] = await Promise.all([fetchApplications(item.id), api<OperatorTimetable>(`/events/${encodeURIComponent(item.id)}/timetable`), api<EventSettings>(`/events/${encodeURIComponent(item.id)}`)]);
    if (event?.id !== item.id) setView("overview");
    setCancelConfirm(false); setTimetable(schedule);
    setEvent(detail); setApplications(result.items); setSelected(null);
  }
  function mutate(path: string, version: number, data: unknown, complete: (result: unknown) => void | Promise<void>, method = "POST", expectedScheduleVersion?: number) {
    // 再試行でも operationId を維持し、不確かな成功を重複適用しない
    const payload = { expectedVersion: version, operationId: crypto.randomUUID(), data, ...(expectedScheduleVersion === undefined ? {} : { expectedScheduleVersion }) };
    void run(async () => { await complete(await api(path, method, payload)); setMessage("保存しました"); });
  }
  /**
   * 審査操作を保存し、自動時間割では末尾の空き位置を割り当てる
   * @param action 実行する審査操作名
   * @returns 戻り値なし
   */
  function review(action: string) {
    if (!selected) return;
    const application = selected;
    if (!event || !timetable) return;
    const tail = timetable.blocks.at(-1);
    const assignedStart = tail?.kind === "closing" ? (tail.locked ? timetable.blocks.at(-2)?.endsAt ?? event.startsAt : tail.startsAt) : tail?.endsAt ?? event.startsAt;
    const data = action === "approve" ? { startsAt: event.scheduleMode === "automatic" ? assignedStart : new Date(startsAt).toISOString(), expectedEventVersion: event.version, expectedScheduleVersion: timetable.version } : action === "reapprove" ? { expectedEventVersion: event.version } : action === "confirm-withdrawal" ? {} : { note };
    mutate(`/applications/${encodeURIComponent(application.id)}/${action}`, application.version, data, async result => {
      const updated = result as OperatorApplication;
      setSelected(updated); setApplications(items => items.map(item => item.id === updated.id ? updated : item));
      const [currentEvent, currentTimetable] = await Promise.all([api<EventSettings>(`/events/${encodeURIComponent(event.id)}`), api<OperatorTimetable>(`/events/${encodeURIComponent(event.id)}/timetable`)]); setEvent(currentEvent); setTimetable(currentTimetable);
    });
  }
  return <section className="lt-manager" aria-busy={busy}>
    <aside className="lt-sidebar"><nav aria-label="LT管理メニュー">
      <button disabled={busy} aria-current={!event && !creating ? "page" : undefined} onClick={() => { setEvent(null); setSelected(null); setCreating(false); }}><CalendarDays aria-hidden="true" />開催回一覧</button>
      {event && !creating && eventViews.map(({ id, label, icon: Icon }) => <button key={id} disabled={busy} aria-current={view === id ? "page" : undefined} onClick={() => { setView(id); setSelected(null); setNote(""); setStartsAt(""); setCancelConfirm(false); }}><Icon aria-hidden="true" />{label}</button>)}
    </nav></aside>
    <div className="lt-content" id="lt-overview"><header className="lt-heading"><h1>LT会</h1></header>
    {!event && !creating && <OperationsMonitor onOpen={(eventId, applicationId) => void run(async () => {
      const detail = await api<EventSettings>(`/events/${encodeURIComponent(eventId)}`);
      await open(detail);
      setCreating(false);
      setView(applicationId ? "applications" : "overview");
      if (applicationId) {
        const application = await api<OperatorApplication>(`/applications/${encodeURIComponent(applicationId)}`);
        setSelected(application); setNote(application.operatorNote); setStartsAt("");
      }
    })} />}
    {error && <div role="alert"><p>{error}</p>{canRetry && <button disabled={busy} onClick={() => retry.current && void run(retry.current)}>再試行</button>}<button disabled={busy} onClick={() => void run(async () => { await loadEvents(); setEvent(null); setSelected(null); setNeedsReload(false); })}>再読込</button></div>}
    <p role="status">{busy ? "処理中…" : message}</p>
    <fieldset disabled={busy || needsReload} style={{ border: 0, padding: 0, minWidth: 0 }}>
    {creating ? <div key="create" className="lt-panel"><button onClick={() => setCreating(false)}>作成を中断</button><h2>開催回を作成</h2><EventForm value={{ id: "", version: 1, state: "scheduled", publishEnabled: false, title: "", venue: "", guidance: "", startsAt: "", timeZone: "", opensAt: "", closesAt: "", approvalMode: "automatic", planning: { relativeRecruitment: true, opensDaysBefore: 28, closesDaysBefore: 7, materialDaysBefore: 3, reminderDaysBefore: 1 }, scheduleMode: "automatic", openingMinutes: 5, breakEvery: 4, breakMinutes: 10, closingMinutes: 5, endsBy: null, capacity: 20, talkMinutes: 10, transitionMinutes: 1 }} onSave={data => { const body = { ...data, operationId: crypto.randomUUID() }; void run(async () => { const created = await api<EventSettings>("/events", "POST", body); await loadEvents(); await open(created); setCreating(false); }); }} /></div> : selected ? <div key="application" className="lt-panel lt-review">
      <button onClick={() => { setSelected(null); setView("applications"); setNote(""); setStartsAt(""); }}><ArrowLeft aria-hidden="true" />申請一覧に戻る</button>
      <h2>{selected.content.title}</h2><p>審査: {selected.waitlisted ? "キャンセル待ち" : selected.review} / 辞退: {selected.withdrawal}</p>
      {selected.review === "approved" && selected.withdrawal === "none" && <SessionEditor key={`${selected.id}:${selected.version}`} application={selected} onSave={(data, done) => mutate(`/applications/${encodeURIComponent(selected.id)}/metadata`, selected.version, data, result => { const updated = result as OperatorApplication; setSelected(updated); setApplications(items => items.map(item => item.id === updated.id ? updated : item)); done(); })} />}
      {canChangeTitle(selected) && <form key={`title:${selected.id}:${selected.version}`} onSubmit={e => {
        e.preventDefault();
        const title = String(new FormData(e.currentTarget).get("title")).trim();
        if (!title) return;
        mutate(`/applications/${encodeURIComponent(selected.id)}/title`, selected.version, { title }, result => {
          const updated = result as OperatorApplication;
          setSelected(updated);
          setApplications(items => items.map(item => item.id === updated.id ? updated : item));
        });
      }}>
        <label>発表タイトル<input name="title" required pattern=".*\S.*" defaultValue={selected.content.title} /></label>
        <p>公開済みの場合は公開ページにも反映されます</p>
        <button>タイトルを保存</button>
      </form>}
      <p>代表者メール: {selected.representativeEmail || "未登録（手動受付）"}</p><h3>申請原稿</h3><dl className="lt-session-facts"><SessionFacts session={selected.content.session} /></dl><p style={{ whiteSpace: "pre-wrap" }}>{selected.content.abstract}</p><p>{selected.content.description}</p>
      <p>{selected.content.speakers.map(speaker => speaker.displayName).join("、")}</p>
      {/^(https?):\/\//i.test(selected.materialUrl) ? <a href={selected.materialUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">資料を確認</a> : <p>資料未提出</p>}
      {selected.materialUrl && <p>資料: {selected.materialReviewed ? "確認済み" : "未確認"} <button disabled={selected.materialReviewed || selected.withdrawal !== "none" || !["scheduled", "started"].includes(selected.eventState)} onClick={() => mutate(`/applications/${encodeURIComponent(selected.id)}/material`, selected.version, { materialUrl: selected.materialUrl }, result => { const updated = result as OperatorApplication; setSelected(updated); setApplications(items => items.map(item => item.id === updated.id ? updated : item)); })}>この資料を確認済みにする</button></p>}
      <div>{selected.content.speakers.map((speaker, index) => <div key={index}><strong>{speaker.displayName}</strong><SpeakerLinks links={speaker.links} /></div>)}</div>
      <h3>公開版</h3>{selected.published ? <><p>{selected.published.title}</p><p>{selected.published.abstract}</p><p>{selected.published.startsAt}</p><dl className="lt-session-facts"><SessionFacts session={selected.published.session} /></dl></> : <p>未公開</p>}
      <label>運営メモ<textarea value={note} onInput={e => setNote(e.currentTarget.value)} /></label>
      {event?.scheduleMode === "automatic" ? <p>承認すると時間割の末尾へ自動配置します。</p> : <label>発表開始日時<input type="datetime-local" value={startsAt} onInput={e => setStartsAt(e.currentTarget.value)} /></label>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <button disabled={(event?.scheduleMode !== "automatic" && !startsAt) || !canReview(selected, "approve")} onClick={() => review("approve")}>{selected.waitlisted ? "繰り上げを承認" : "承認"}</button>
      <button disabled={!canReapprove(selected)} onClick={() => review("reapprove")}>再承認</button>
      <button disabled={!canReview(selected, "return")} onClick={() => review("return")}>差し戻し</button><button disabled={!canReview(selected, "hold")} onClick={() => review("hold")}>保留</button>
      <button disabled={!canReview(selected, "reject")} onClick={() => review("reject")}>見送り</button>
      <button disabled={selected.withdrawal !== "requested"} onClick={() => review("confirm-withdrawal")}>辞退確定</button></div>
      <EmailChangePanel key={selected.id} applicationId={selected.id} applicationVersion={selected.version} onConfirmed={async () => { const updated = await api<OperatorApplication>(`/applications/${encodeURIComponent(selected.id)}`); setSelected(updated); setApplications(items => items.map(item => item.id === updated.id ? updated : item)); }} />
    </div> : event ? <div key="event">
      <button onClick={() => { setEvent(null); setApplications([]); }}><ArrowLeft aria-hidden="true" />開催回一覧に戻る</button><h2>{event.title}</h2>{!event.publishEnabled && <p role="status">非公開・募集停止中です。受付日時を確定して保存してください。</p>}
      <div hidden={view !== "overview"}><div className="lt-stats" aria-label="全申請の集計"><div><span><Users aria-hidden="true" />全申請</span><strong>{applications.length}</strong></div><div><span><CircleCheck aria-hidden="true" />承認済み</span><strong>{applications.filter(item => item.review === "approved").length}</strong></div><div><span><Clock aria-hidden="true" />審査・保留中</span><strong>{applications.filter(item => ["pending", "held", "resubmitted"].includes(item.review)).length}</strong></div><div><span><UserMinus aria-hidden="true" />辞退の確認待ち</span><strong>{applications.filter(item => item.withdrawal === "requested").length}</strong></div></div>
      <section className="lt-panel" aria-label="要対応"><h3>要対応</h3><p>空き枠: {Math.max(0, event.capacity - applications.filter(item => item.slotReserved).length)}件</p>
        {actionItems(applications).length === 0 ? <p>対応待ちはありません</p> : <ul>{actionItems(applications).map(({application, reasons}) => <li key={application.id}><button onClick={() => void run(async () => { const detail = await api<OperatorApplication>(`/applications/${encodeURIComponent(application.id)}`); setSelected(detail); setNote(detail.operatorNote); setStartsAt(""); })}>{application.content.title}</button> — {reasons.join("、")}</li>)}</ul>}
      </section>
      </div>
      <section hidden={view !== "applications"} className="lt-panel" id="lt-applications"><div className="lt-panel-heading"><h3>申請一覧</h3></div>{applications.length === 0 && <p>申請はありません</p>}
      <div className="lt-table-scroll"><table className="lt-table"><thead><tr><th scope="col">発表タイトル</th><th scope="col">登壇者</th><th scope="col">審査状況</th><th scope="col">辞退状況</th></tr></thead><tbody>{applications.map(item => <tr key={item.id}><td><button className="lt-title-button" onClick={() => { void run(async () => { const detail = await api<OperatorApplication>(`/applications/${encodeURIComponent(item.id)}`); setSelected(detail); setNote(detail.operatorNote); setStartsAt(""); }); }}>{item.content.title}</button></td><td>{item.content.speakers.map(speaker => speaker.displayName).join("、")}</td><td><span className="lt-badge">{item.waitlisted ? "キャンセル待ち" : ({ pending: "審査待ち", held: "保留", approved: "承認済み", returned: "差し戻し", resubmitted: "再申請", rejected: "見送り", withdrawn: "辞退済み" })[item.review]}</span></td><td>{({ none: "—", requested: "確認待ち", confirmed: "確定" })[item.withdrawal]}</td></tr>)}</tbody></table></div>
      </section><section hidden={view !== "timetable"} className="lt-panel" id="lt-timetable"><div className="lt-panel-heading"><h3>タイムテーブル編集</h3></div>{timetable && <TimetableEditor key={`${timetable.eventId}:${timetable.version}:${event.timeZone}`} blocks={timetable.blocks} event={event} applications={applications} disabled={busy || needsReload} onSave={blocks => mutate(`/events/${encodeURIComponent(event.id)}/timetable`, timetable.version, { blocks, expectedEventVersion: event.version }, result => { const saved = result as OperatorTimetable; setTimetable(saved); setEvent(current => current ? syncTimetableEvent(current, saved) : current); }, "PUT")} />}
    </section>
      <section hidden={view !== "settings"} className="lt-panel" id="lt-settings"><div className="lt-panel-heading"><h3>開催回の設定</h3></div><EventForm key={`${event.id}:${event.version}`} value={event} blocks={timetable?.blocks} onSave={value => mutate(`/events/${encodeURIComponent(event.id)}`, event.version, value, async result => { const updated = result as EventSettings; setEvents(items => items.map(item => item.id === updated.id ? updated : item)); await open(updated); }, "PATCH", timetable?.version)} />
      </section><section hidden={view !== "exceptions"} className="lt-panel" id="lt-exceptions"><h3>例外対応・手動処理</h3><button onClick={() => mutate(`/events/${encodeURIComponent(event.id)}/copy`, event.version, {}, async result => { await loadEvents(); await open(result as EventSettings); })}>この運営ルールから次回を作成</button>
      <button disabled={event.state === "cancelled"} onClick={() => setCancelConfirm(true)}>開催中止</button>
      {cancelConfirm && <div role="group" aria-label="開催中止の確認"><p>この開催回を中止しますか？</p><button onClick={() => mutate(`/events/${encodeURIComponent(event.id)}/cancel`, event.version, {}, result => { const updated = result as EventSettings; setEvent(updated); setEvents(items => items.map(item => item.id === updated.id ? updated : item)); setCancelConfirm(false); })}>中止を確定</button><button onClick={() => setCancelConfirm(false)}>中止を取り消す</button></div>}
      </section>
    </div> : <div key="events" className="lt-panel lt-events"><h2>開催回一覧</h2>{events.length === 0 && !error && <p>開催回がありません。最初の開催回を作成してください。</p>}<button onClick={() => setCreating(true)}><Plus aria-hidden="true" />開催回を作成</button><ul className="lt-event-list">{events.map(item => <li key={item.id}><button onClick={() => void run(() => open(item))}><CalendarDays aria-hidden="true" /><span>{item.title}</span><span className="lt-badge">{({ scheduled: "開催予定", started: "開催中", ended: "終了", cancelled: "中止" })[item.state]}</span> {!item.publishEnabled && "非公開・日時未確定"}</button></li>)}</ul></div>}
    </fieldset>
    </div>
  </section>;
}
