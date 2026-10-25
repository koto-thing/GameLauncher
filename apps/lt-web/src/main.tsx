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
import "./style.css";
import { ApplicationForm } from "./ApplicationForm";
import { operation } from "./operation";
const devFixture = import.meta.env.DEV && import.meta.env.VITE_LT_FIXTURE === "true";
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (devFixture) return (await import("./fixture")).fixture<T>(path);
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
  location.pathname === "/auth/verify" ? new URLSearchParams(location.search).get("token") : null;
if (token) history.replaceState(null, "", location.pathname);
function App() {
  const [events, setEvents] = useState<PublicEventPage>({ items: [], nextCursor: null });
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
    api<PublicEventPage>("/events")
      .then(setEvents)
      .catch(() => {});
    api<{ expiresAt: string } | null>("/auth/session")
      .then((s) => setSession(s?.expiresAt ?? null))
      .catch(() => setSession(null));
  }, [revision]);
  useEffect(() => {
    const pop = () => {
      setPath(location.pathname);
      setEditing(null);
    };
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setEditing(null);
    const endpoint =
      path === "/applications" ? "/applications" : path.startsWith("/events/") ? path : "/events";
    if (path === "/auth/verify" || path === "/login" || path === "/applications/new") return;
    api(endpoint + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""))
      .then((d) => {
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
    setCursor(null);
    history.pushState(null, "", p);
    setPath(p);
    setNotice("");
  }
  async function run(work: () => Promise<unknown>) {
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
            const op = operation(a?.id ?? "new", payload);
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
  return (
    <>
      <header>
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            nav("/");
          }}
        >
          LT会
        </a>
        <nav>
          <button onClick={() => nav("/")}>開催回</button>
          <button onClick={() => nav("/applications")}>本人申請</button>
          <button onClick={() => nav("/login")}>メール確認</button>
        </nav>
      </header>
      <main>
        {session && (
          <p>
            セッション期限: {session}
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
        {devFixture && <aside>開発 fixture・架空データ／API 未接続</aside>}
        {error && (
          <div role="alert">
            {error}
            <button onClick={() => reload((n) => n + 1)}>再読み込み</button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {busy && <p role="status">送信中…</p>}
        {path === "/login" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const email = new FormData(e.currentTarget).get("email");
              void run(async () => {
                await api("/auth/email", { method: "POST", body: JSON.stringify({ email }) });
                setNotice(
                  "対象のメールアドレスには確認案内が届きます。確認リンクは1時間有効です。",
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
          form(editing)
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
                <p>
                  {a.review} / {a.withdrawal}
                </p>
                {a.retentionExpiresAt && <p>保持期限: {a.retentionExpiresAt}</p>}
                <a href={a.materialUrl} rel="noreferrer">
                  資料
                </a>
                {actions(a).map((action) => (
                  <button
                    key={action}
                    disabled={busy}
                    onClick={() =>
                      action === "edit"
                        ? setEditing(a)
                        : void run(() =>
                            api(`/applications/${encodeURIComponent(a.id)}/${action}`, {
                              method: "POST",
                              body: JSON.stringify({
                                expectedVersion: a.version,
                                operationId: operation(`${a.id}/${action}`, {
                                  expectedVersion: a.version,
                                }).id,
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
        ) : path.includes("/talks/") ? (
          <section>
            <h1>{(data as PublicTalk)?.title}</h1>
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
          <button disabled={busy} onClick={() => setCursor((data as ApplicationPage).nextCursor)}>
            次のページ
          </button>
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
