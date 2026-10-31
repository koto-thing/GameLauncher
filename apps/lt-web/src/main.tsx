import { MaterialForm } from "./MaterialForm";
import { ThemeToggle } from "./ThemeToggle";
import { LegalPage, SiteFooter } from "./LegalPage";
import { EmailChange } from "./EmailChange";
import { PublicSite } from "./PublicSite";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Application,
  ApplicationPage,
  PublicEventPage,
  PublicEvent,
  PublicTalk,
} from "../../../contracts/lt/v1";
import { request } from "./api";
import { actions } from "./policy";
import { canChangePresentation } from "../../../contracts/lt/application-policy";
import "./style.css";
import "./theme.css";
import { ApplicationForm } from "./ApplicationForm";
import { operation } from "./operation";
import { allEvents, formatInstant } from "./events";
import { applicationsAvailable, isPublicPage, unavailableMessage } from "./availability";
const devFixture = import.meta.env.DEV && import.meta.env.VITE_LT_FIXTURE === "true";
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (devFixture) return (await import("./fixture")).fixture<T>(path, init);
  return request<T>(path, init);
}
const labels: Record<string, string> = {
  edit: "編集",
  resubmit: "再提出",
  withdraw: "取り下げ",
  "request-withdrawal": "辞退依頼",
  "cancel-withdrawal": "辞退依頼を取消",
};
// token を画面や外部参照へ流さず、GET では交換しない
let token =
  applicationsAvailable && location.pathname === "/auth/verify"
    ? new URLSearchParams(location.search).get("token")
    : null;
if (token || (!applicationsAvailable && location.pathname.startsWith("/auth/")))
  history.replaceState(null, "", location.pathname);
/**
 * 本人申請と公開発表の画面を表示する
 * @returns 現在のパスに対応する画面
 */
function App() {
  const [events, setEvents] = useState<PublicEventPage>({ items: [], nextCursor: null });
  const [detailEvent, setDetailEvent] = useState<PublicEvent | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [path, setPath] = useState(location.pathname),
    [data, setData] = useState<unknown>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [revision, reload] = useState(0),
    [editing, setEditing] = useState<Application | null>(null);
  useEffect(() => {
    if (!applicationsAvailable) return;
    allEvents(api)
      .then(setEvents)
      .catch((e) => setError(e.message));
    api<{ expiresAt: string } | null>("/auth/session")
      .then((s) => setSession(s?.expiresAt ?? null))
      .catch(() => setSession(null));
  }, [revision]);
  useEffect(() => {
    const pop = () => {
      setData(null);
      setCursor(new URLSearchParams(location.search).get("cursor"));
      setPath(location.pathname);
      setEditing(null);
    };
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    let active = true;
    setData(null);
    setDetailEvent(null);
    setError("");
    setEditing(null);
    if (!applicationsAvailable && !isPublicPage(path)) return;
    const endpoint =
      path === "/applications"
        ? "/applications"
        : path.startsWith("/events/") || path.startsWith("/applications/")
          ? path
          : "/events";
    if (path === "/auth/verify" || path === "/login" || path === "/applications/new") return;
    api(endpoint + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""))
      .then(async (d) => {
        if (path.startsWith("/events/")) {
          const eventId = path.split("/")[2];
          const event = path.includes("/talks/")
            ? await api<PublicEvent>(`/events/${eventId}`)
            : (d as PublicEvent);
          if (active) setDetailEvent(event);
        }
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path, revision, cursor]);
  function nav(p: string) {
    if (isPublicPage(p)) {
      location.assign(p);
      return;
    }
    setData(null);
    setCursor(null);
    history.pushState(null, "", p);
    setPath(p);
    setNotice("");
  }
  async function run(work: () => Promise<unknown>) {
    if (!applicationsAvailable) return;
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      setNotice("操作を受け付けました");
      reload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }
  function date(value: string, eventId: string) {
    const zone =
      detailEvent?.id === eventId
        ? detailEvent.timeZone
        : events.items.find((e) => e.id === eventId)?.timeZone;
    return zone ? formatInstant(value, zone) : "開催タイムゾーンを取得できません";
  }
  function form(a: Application | null) {
    return (
      <ApplicationForm
        application={a}
        events={events}
        busy={busy}
        cancel={() => {
          setEditing(null);
          if (!a) nav("/applications");
        }}
        save={(payload) =>
          void run(async () => {
            const op = await operation(a?.id ?? "new", payload);
            await api(a ? `/applications/${encodeURIComponent(a.id)}` : "/applications", {
              method: a ? "PATCH" : "POST",
              body: JSON.stringify(
                a
                  ? { expectedVersion: a.version, operationId: op.id, data: payload }
                  : { ...(payload as object), operationId: op.id },
              ),
            });
            op.complete();
            setEditing(null);
            nav("/applications");
          })
        }
      />
    );
  }
  /**
   * 申請状態を保持して発表タイトル・概要を変更するフォームを表示する
   * @param application 変更対象の本人申請
   * @returns タイトル・概要編集フォームまたは変更不可の場合はnull
   */
  function presentationForm(application: Application) {
    if (!canChangePresentation(application)) return null;

    // 保存後の再取得で入力値と版を最新の申請へ揃える
    return (
      <form
        key={`presentation:${application.id}:${application.version}`}
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const title = String(form.get("title")).trim();
          const abstract = String(form.get("abstract")).trim();
          if (!title || !abstract) return;
          void run(async () => {
            const data = { title, abstract };
            const op = await operation(`${application.id}/presentation`, {
              expectedVersion: application.version,
              data,
            });
            await api(`/applications/${encodeURIComponent(application.id)}/presentation`, {
              method: "POST",
              body: JSON.stringify({
                expectedVersion: application.version,
                operationId: op.id,
                data,
              }),
            });
            op.complete();
          });
        }}
      >
        <label>
          発表タイトル
          <input
            name="title"
            required
            pattern=".*\S.*"
            defaultValue={application.content.title}
            disabled={busy}
          />
        </label>
        <label htmlFor={`presentation-abstract:${application.id}`}>発表概要</label>
        <textarea
          id={`presentation-abstract:${application.id}`}
          name="abstract"
          required
          defaultValue={application.content.abstract}
          disabled={busy}
          rows={5}
        />
        <p>公開済みの場合はタイトルと概要の両方が公開ページにも反映されます</p>
        <button disabled={busy}>タイトル・概要を保存</button>
      </form>
    );
  }
  return (
    <>
      <header className="applicant-header">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            nav("/");
          }}
        >
          PandD LT
        </a>
        <nav>
          <button onClick={() => nav("/")}>開催回</button>
          {applicationsAvailable && (
            <>
              <button onClick={() => nav("/applications")}>申請一覧</button>
              <button onClick={() => nav("/login")}>メール確認</button>
            </>
          )}
        </nav>
        <ThemeToggle />
      </header>
      <main className="applicant-main">
        {!applicationsAvailable && isPublicPage(path) && <p role="status">{unavailableMessage}</p>}
        {session && (
          <p className="account-status">
            メール認証済み
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("/auth/logout", { method: "POST" });
                  setSession(null);
                  nav("/");
                })
              }
            >
              ログアウト
            </button>
          </p>
        )}
        {(devFixture || (import.meta.env.DEV && import.meta.env.VITE_LT_QA === "true")) && (
          <aside>開発 fixture・架空データ／API 未接続</aside>
        )}
        {error && (
          <div role="alert">
            {error}
            <button onClick={() => reload((n) => n + 1)}>再読み込み</button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {busy && <p role="status">送信中…</p>}
        {!applicationsAvailable && !isPublicPage(path) ? (
          <section>
            <h1>現在利用できません</h1>
            <p>{unavailableMessage}</p>
            <a href="/">開催回を見る</a>
          </section>
        ) : path === "/login" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const email = new FormData(e.currentTarget).get("email");
              void run(async () => {
                await api("/auth/email", { method: "POST", body: JSON.stringify({ email }) });
                setNotice(
                  "対象のメールアドレスには確認案内が届きます。確認リンクは1時間有効です。メールが届かない場合は、迷惑メールフォルダもご確認ください。",
                );
              });
            }}
          >
            <h1>メール確認</h1>
            <label>
              メールアドレス
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <button disabled={busy}>確認案内を送る</button>
            <p>メールが届かない場合は、迷惑メールフォルダもご確認ください。</p>
          </form>
        ) : path === "/auth/verify" ? (
          <section>
            <h1>メールを確認</h1>
            <p>確認ボタンを押すとリンクを交換します。</p>
            <button
              disabled={busy || !token}
              onClick={() =>
                void run(async () => {
                  await api("/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
                  token = null;
                  nav("/applications");
                })
              }
            >
              確認する
            </button>
            {!token && <p>確認リンクがありません。メール確認からやり直してください。</p>}
          </section>
        ) : editing ? (
          editing.eventState === "cancelled" ? (
            <p role="alert">この開催回は中止されました。編集できません。</p>
          ) : (
            form(editing)
          )
        ) : path === "/applications/new" ? (
          form(null)
        ) : !data && !error ? (
          <p role="status">読み込み中…</p>
        ) : path === "/applications" ? (
          <section>
            <h1>本人申請</h1>
            <button onClick={() => nav("/applications/new")}>新規申請</button>
            {(data as ApplicationPage)?.items.map((a) => (
              <article key={a.id}>
                <h2>{a.content.title}</h2>
                {presentationForm(a)}
                <p>
                  {a.waitlisted ? "キャンセル待ち（登壇未確定）" : a.review} / {a.withdrawal}
                </p>
                {a.eventState === "cancelled" && <p role="status">この開催回は中止されました</p>}
                {a.eventState === "cancelled" && a.eventCancelledAt && (
                  <p>
                    中止確定日時 (UTC):{" "}
                    <time dateTime={a.eventCancelledAt}>
                      {formatInstant(a.eventCancelledAt, "UTC")}
                    </time>
                  </p>
                )}
                {a.retentionExpiresAt && <p>保持期限: {a.retentionExpiresAt}</p>}
                {a.published && (
                  <p>
                    発表時刻: {date(a.published.startsAt, a.eventId)} ～{" "}
                    {date(a.published.endsAt, a.eventId)}
                  </p>
                )}
                {a.materialUrl && (
                  <a href={a.materialUrl} rel="noreferrer">
                    資料
                  </a>
                )}
                {["scheduled", "started"].includes(a.eventState) &&
                  !["rejected", "withdrawn"].includes(a.review) &&
                  a.withdrawal === "none" && (
                    <MaterialForm
                      key={`${a.id}:${a.version}`}
                      application={a}
                      disabled={busy}
                      onSave={(materialUrl) =>
                        void run(async () => {
                          const data = { materialUrl };
                          await api(`/applications/${encodeURIComponent(a.id)}/material`, {
                            method: "POST",
                            body: JSON.stringify({
                              expectedVersion: a.version,
                              operationId: (
                                await operation(`${a.id}/material`, {
                                  expectedVersion: a.version,
                                  data,
                                })
                              ).id,
                              data,
                            }),
                          });
                        })
                      }
                    />
                  )}
                {actions(a).map((action) => (
                  <button
                    key={action}
                    disabled={busy}
                    onClick={() =>
                      action === "edit"
                        ? setEditing(a)
                        : void run(async () =>
                            api(`/applications/${encodeURIComponent(a.id)}/${action}`, {
                              method: "POST",
                              body: JSON.stringify({
                                expectedVersion: a.version,
                                operationId: (
                                  await operation(`${a.id}/${action}`, {
                                    expectedVersion: a.version,
                                  })
                                ).id,
                                data: {},
                              }),
                            }),
                          )
                    }
                  >
                    {labels[action]}
                  </button>
                ))}
              </article>
            ))}
            {(data as ApplicationPage)?.items.length === 0 && <p>申請はありません。</p>}
          </section>
        ) : path.startsWith("/applications/") && data ? (
          <section>
            <h1>{(data as Application).content.title}</h1>
            {presentationForm(data as Application)}
            <p>{(data as Application).review}</p>
            {(data as Application).eventCancelledAt && (
              <p>
                中止確定日時 (UTC): {formatInstant((data as Application).eventCancelledAt!, "UTC")}
              </p>
            )}
            {(data as Application).eventState === "cancelled" && (
              <p role="status">この開催回は中止されました</p>
            )}
            <button onClick={() => nav("/applications")}>本人申請一覧に戻る</button>
            {actions(data as Application).includes("edit") && (
              <button onClick={() => setEditing(data as Application)}>編集</button>
            )}
          </section>
        ) : path.includes("/talks/") ? (
          <section>
            <h1>{(data as PublicTalk)?.title}</h1>
            {(data as PublicTalk)?.cancelled && <p role="status">登壇中止</p>}
            {Boolean(data) && (
              <p>
                {date((data as PublicTalk).startsAt, (data as PublicTalk).eventId)} –{" "}
                {date((data as PublicTalk).endsAt, (data as PublicTalk).eventId)}
              </p>
            )}
            <p>{(data as PublicTalk)?.abstract}</p>
            {(data as PublicTalk)?.description && <p>{(data as PublicTalk).description}</p>}
            {(data as PublicTalk)?.speakers.map((s) => (
              <p key={s.displayName}>
                {s.displayName}
                {s.affiliation && ` / ${s.affiliation}`}
                {s.profile && ` — ${s.profile}`}
              </p>
            ))}
          </section>
        ) : path.startsWith("/events/") ? (
          <section>
            <h1>{(data as PublicEvent)?.title}</h1>
            <p>{(data as PublicEvent)?.venue}</p>
            {(data as PublicEvent)?.guidance && <p>{(data as PublicEvent).guidance}</p>}
            <h2>時間割</h2>
            {(data as PublicEvent)?.schedule.map((b) => (
              <article key={b.id}>
                <time>
                  {b.startsAt} – {b.endsAt}
                </time>
                {b.talkId ? (
                  <button onClick={() => nav(`${path}/talks/${encodeURIComponent(b.talkId!)}`)}>
                    発表詳細
                  </button>
                ) : (
                  <p>{b.kind}</p>
                )}
              </article>
            ))}
            {(data as PublicEvent)?.schedule.length === 0 && <p>時間割は未設定です。</p>}
          </section>
        ) : (
          <section>
            <h1>開催回</h1>
            {(data as PublicEventPage)?.items.map((e) => (
              <article key={e.id}>
                <h2>
                  <a
                    href={`/events/${encodeURIComponent(e.id)}`}
                    onClick={(ev) => {
                      ev.preventDefault();
                      nav(`/events/${encodeURIComponent(e.id)}`);
                    }}
                  >
                    {e.title}
                  </a>
                </h2>
                <p>
                  {new Intl.DateTimeFormat("ja-JP", {
                    dateStyle: "long",
                    timeStyle: "short",
                    timeZone: e.timeZone,
                  }).format(new Date(e.startsAt))}
                </p>
                <p>{e.venue}</p>
                {Date.parse(e.endsAt) < Date.now() && <p>過去回</p>}
              </article>
            ))}
            {(data as PublicEventPage)?.items.length === 0 && <p>公開中の開催回はありません。</p>}
          </section>
        )}
        {(data as ApplicationPage | null)?.nextCursor && (
          <button
            disabled={busy}
            onClick={() => {
              const next = (data as ApplicationPage).nextCursor;
              history.pushState(null, "", `${path}?cursor=${encodeURIComponent(next!)}`);
              setCursor(next);
            }}
          >
            次のページ
          </button>
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.pathname === "/privacy" || location.pathname === "/disclaimer" ? (
      <LegalPage privacy={location.pathname === "/privacy"} />
    ) : !applicationsAvailable || isPublicPage(location.pathname) ? (
      <PublicSite />
    ) : location.pathname === "/auth/email-change" ? (
      <EmailChange />
    ) : (
      <App />
    )}
    <SiteFooter />
  </StrictMode>,
);
