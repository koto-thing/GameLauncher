import { ThemeToggle } from "./ThemeToggle";
import { useEffect, useState } from "react";
import type { PublicEvent, PublicEventPage, PublicTalk } from "../../../contracts/lt/v1";
import { request } from "./api";
import { applicationsAvailable, isPublicPage, unavailableMessage } from "./availability";
import "./public.css";
import { PublicSchedule, type ScheduleView } from "./PublicSchedule";
import { PublicTalkDetail } from "./PublicTalkDetail";
import { publicDate as date } from "./public-display";

const tabs = [
  ["home", "開催案内"],
  ["schedule", "タイムテーブル"],
  ["archive", "過去の開催"],
  ["about", "参加・お問い合わせ"],
] as const;
type Tab = (typeof tabs)[number][0];

/** 公開DTOだけを取得し、開発用データは本番bundleから除外する */
async function read<T>(path: string): Promise<T> {
  if (import.meta.env.DEV && import.meta.env.VITE_LT_FIXTURE === "true")
    return (await import("./fixture")).fixture<T>(path);
  return request<T>(path);
}

/** 公開レイアウトを実データへ接続し、有効な申請経路を案内する */
export function PublicSite() {
  const [path, setPath] = useState(location.pathname);
  const [view, setView] = useState<ScheduleView>(() =>
    new URLSearchParams(location.search).get("list") === "1" ? "list" : "table",
  );
  const [tab, setTab] = useState<Tab>(() =>
    tabs.some(([key]) => key === location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : "home",
  );
  const [page, setPage] = useState<PublicEventPage>({ items: [], nextCursor: null });
  const [selected, setSelected] = useState<PublicEvent | null>(null);
  const [talk, setTalk] = useState<PublicTalk | null>(null);
  const [talks, setTalks] = useState<Record<string, PublicTalk>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, retry] = useState(0);
  const [authenticated, setAuthenticated] = useState(false);

  // サーバーで確認できた有効な本人セッションだけ申請確認リンクを表示する
  useEffect(() => {
    if (!applicationsAvailable) return;
    let active = true;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    request<{ expiresAt: string } | null>("/auth/session")
      .then((session) => {
        if (!active) return;
        const remaining = session ? Date.parse(session.expiresAt) - Date.now() : 0;
        setAuthenticated(remaining > 0);
        if (remaining > 0) expiryTimer = setTimeout(() => setAuthenticated(false), remaining);
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      });
    return () => {
      active = false;
      clearTimeout(expiryTimer);
    };
  }, []);
  const valid = isPublicPage(path);
  const event =
    selected ??
    [...page.items]
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .find((item) => Date.parse(item.endsAt) >= Date.now()) ??
    null;
  const poster = event?.posterUrl;
  const eventPath = event ? "/events/" + encodeURIComponent(event.id) : "/";

  // 戻る・直接URLでも同じ公開画面を表示する
  useEffect(() => {
    const sync = () => {
      setPath(location.pathname);
      setView(new URLSearchParams(location.search).get("list") === "1" ? "list" : "table");
      setTab(
        tabs.some(([key]) => key === location.hash.slice(1))
          ? (location.hash.slice(1) as Tab)
          : "home",
      );
    };
    addEventListener("popstate", sync);
    addEventListener("hashchange", sync);
    return () => {
      removeEventListener("popstate", sync);
      removeEventListener("hashchange", sync);
    };
  }, []);

  // 停止中の本人URLでは公開一覧も含めAPIを呼ばない
  useEffect(() => {
    let active = true;
    setSelected(null);
    setTalk(null);
    setError("");
    setLoading(valid);
    if (!valid) return;
    const segments = path.split("/");
    const load = async () => {
      if (segments[1] === "events" && segments[2]) {
        const value = await read<PublicEvent>(
          "/events/" + encodeURIComponent(decodeURIComponent(segments[2])),
        );
        if (active) setSelected(value);
        if (segments[3] === "talks" && segments[4]) {
          const value = await read<PublicTalk>(path);
          if (active) setTalk(value);
        }
      } else {
        const value = await read<PublicEventPage>("/events");
        if (active) setPage(value);
      }
    };
    void load()
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "公開情報を取得できませんでした");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, valid, revision]);

  // 発表名・登壇者も公開専用DTOから読み、私有申請は参照しない
  useEffect(() => {
    let active = true;
    setTalks({});
    if (!event || talk || tab === "archive" || tab === "about") return;
    const ids = [
      ...new Set(event.schedule.flatMap((block) => (block.talkId ? [block.talkId] : []))),
    ];
    void Promise.all(
      ids.map(async (id) => {
        try {
          return await read<PublicTalk>(
            "/events/" + encodeURIComponent(event.id) + "/talks/" + encodeURIComponent(id),
          );
        } catch {
          return null;
        }
      }),
    ).then((values) => {
      if (active)
        setTalks(
          Object.fromEntries(
            values
              .filter((item): item is PublicTalk => item !== null)
              .map((item) => [item.id, item]),
          ),
        );
    });
    return () => {
      active = false;
    };
  }, [event, talk, tab]);

  /** 履歴を保ち、公開URLとタブだけを変更する */
  function navigate(next: string, nextTab?: Tab) {
    const url = new URL(next, location.origin);
    const targetTab = nextTab ?? (url.hash === "#schedule" ? "schedule" : "home");
    const targetView = url.searchParams.has("list")
      ? url.searchParams.get("list") === "1"
        ? "list"
        : "table"
      : view;
    if (targetTab === "schedule" || url.pathname.includes("/talks/"))
      url.searchParams.set("list", targetView === "list" ? "1" : "0");
    url.hash = targetTab === "home" ? "" : targetTab;
    history.pushState(null, "", url.pathname + url.search + url.hash);
    setPath(url.pathname);
    setTab(targetTab);
    setView(targetView);
    window.scrollTo({ top: 0 });
  }

  // 発表への直接リンクでも内容が分かるページタイトルにする
  useEffect(() => {
    document.title = talk
      ? talk.title + " | PandD LT"
      : (tab === "schedule" ? "タイムテーブル | " : "") + "PandD LT";
  }, [talk, tab]);

  /** 公開一覧の次ページを既存DTO契約で追加取得する */
  async function more() {
    if (!page.nextCursor) return;
    setLoading(true);
    try {
      const next = await read<PublicEventPage>(
        "/events?cursor=" + encodeURIComponent(page.nextCursor),
      );
      setPage({ items: [...page.items, ...next.items], nextCursor: next.nextCursor });
    } catch {
      setError("次の開催回を取得できませんでした");
    } finally {
      setLoading(false);
    }
  }

  const noEvent = (
    <section className="empty public-empty">
      <h1>公開中の開催回はありません</h1>
      <p>次の開催案内をお待ちください。</p>
    </section>
  );
  const talkLink = (id: string) =>
    eventPath + "/talks/" + encodeURIComponent(id) + "?list=" + (view === "list" ? "1" : "0");
  const publicTalks =
    event?.schedule.flatMap((block) =>
      block.talkId && talks[block.talkId] ? [talks[block.talkId]] : [],
    ) ?? [];

  return (
    <div className="public-site">
      <header className="shell-header">
        <div className="nav-shell">
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            <img
              className="brand-logo"
              src="/pandd-logo.png"
              alt="PandD"
              width="1500"
              height="1500"
            />
            <strong className="brand-title">PandD LT</strong>
          </a>
          <ThemeToggle />
        </div>
      </header>
      <nav className="sub-nav" aria-label="公開情報">
        {tabs.map(([key, label]) => (
          <a
            key={key}
            href={
              (key === "archive" || key === "about" ? "/" : eventPath) +
              (key === "home" ? "" : "#" + key)
            }
            className={(talk ? "schedule" : tab) === key ? "active" : ""}
            aria-current={(talk ? "schedule" : tab) === key ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              navigate(key === "archive" || key === "about" ? "/" : eventPath, key);
            }}
          >
            {label}
          </a>
        ))}
      </nav>
      <main className="container public-main">
        {!applicationsAvailable && (
          <p className="notice unavailable" role="status">
            {unavailableMessage}
          </p>
        )}
        {applicationsAvailable && (
          <p className="notice">
            <a href="/login">メール確認・登壇申請</a>
            {authenticated && (
              <>
                {" "}
                ／ <a href="/applications">申請内容を確認</a>
              </>
            )}
          </p>
        )}
        {import.meta.env.DEV && import.meta.env.VITE_LT_QA === "true" && (
          <aside className="notice">開発 fixture・架空データ／API 未接続</aside>
        )}
        {!valid ? (
          <section className="empty public-empty">
            <h1>現在利用できません</h1>
            <p>{unavailableMessage}</p>
            <a className="btn" href="/">
              開催回を見る
            </a>
          </section>
        ) : error ? (
          <section className="empty public-empty" role="alert">
            <h1>公開情報を取得できませんでした</h1>
            <p>{error}</p>
            <button className="btn" onClick={() => retry((n) => n + 1)}>
              再読み込み
            </button>
          </section>
        ) : loading ? (
          <p role="status">読み込み中…</p>
        ) : talk && event ? (
          <PublicTalkDetail talk={talk} event={event} view={view} navigate={navigate} />
        ) : tab === "about" ? (
          <>
            <div className="page-head">
              <h1>参加・お問い合わせ</h1>
            </div>
            <div className="cols-2">
              <section className="panel">
                <h2>聴講について</h2>
                <p>参加条件は各開催案内をご確認ください。</p>
                <a
                  className="btn"
                  href="/"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/");
                  }}
                >
                  開催案内を確認
                </a>
              </section>
              <section className="panel">
                <h2>お問い合わせ</h2>
                <p>
                  <a className="contact-link" href="mailto:panddmail@gmail.com">
                    panddmail@gmail.com
                  </a>
                </p>
                {applicationsAvailable ? (
                  <p>
                    <a href="/login">メール確認・登壇申請へ</a>
                  </p>
                ) : (
                  <p className="muted small">登壇申請・メール確認は現在停止しています。</p>
                )}
              </section>
            </div>
          </>
        ) : tab === "archive" ? (
          <>
            <div className="page-head">
              <h1>過去の開催</h1>
            </div>
            {page.items
              .filter((item) => Date.parse(item.endsAt) < Date.now())
              .map((item) => (
                <a
                  className="panel archive-card"
                  key={item.id}
                  href={"/events/" + encodeURIComponent(item.id)}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/events/" + encodeURIComponent(item.id));
                  }}
                >
                  <span className="archive-number">
                    {new Intl.DateTimeFormat("ja-JP", {
                      year: "numeric",
                      timeZone: item.timeZone,
                    }).format(new Date(item.startsAt))}
                  </span>
                  <div>
                    <h2>{item.title}</h2>
                    <p className="muted small">
                      {date(item.startsAt, item.timeZone)} ／ {item.venue}
                    </p>
                  </div>
                  <span className="circle-arrow" aria-hidden="true">
                    ›
                  </span>
                </a>
              ))}
            {!page.items.some((item) => Date.parse(item.endsAt) < Date.now()) && (
              <section className="empty">
                <p>公開中の過去の開催はありません。</p>
              </section>
            )}
          </>
        ) : !event ? (
          noEvent
        ) : tab === "schedule" ? (
          <PublicSchedule
            event={event}
            talks={talks}
            view={view}
            navigate={navigate}
            onViewChange={(value) =>
              navigate(eventPath + "?list=" + (value === "list" ? "1" : "0"), "schedule")
            }
          />
        ) : (
          <>
            <section className={poster ? "hero hero-with-poster" : "hero"}>
              <div className="hero-copy">
                <span className="event-state">
                  {Date.parse(event.endsAt) < Date.now() ? "開催終了" : "開催案内"}
                </span>
                <h1>
                  <a
                    href={eventPath}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(eventPath);
                    }}
                  >
                    {event.title}
                  </a>
                </h1>
                {event.guidance && <p className="event-guidance public-prose">{event.guidance}</p>}
                <div className="hero-buttons">
                  <a
                    className="btn coral"
                    href={eventPath + "#schedule"}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(eventPath, "schedule");
                    }}
                  >
                    タイムテーブル
                  </a>
                  {applicationsAvailable && event.recruitment === "open" ? (
                    <a className="btn" href="/login">
                      登壇申請
                    </a>
                  ) : (
                    <button className="btn" disabled>
                      登壇申請（受付期間外）
                    </button>
                  )}
                </div>
              </div>
              {poster && (
                <a
                  className="event-poster"
                  href={poster}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${event.title}のポスターを原寸で開く（新しいタブ）`}
                >
                  <img
                    src={poster}
                    alt={`${event.title}の開催ポスター`}

                  />
                </a>
              )}
            </section>
            <div className="feature-strip">
              <div className="feature">
                <div className="f-key">開催日</div>
                <div className="f-val">{date(event.startsAt, event.timeZone)}</div>
              </div>
              <div className="feature">
                <div className="f-key">時間</div>
                <div className="f-val">
                  {date(event.startsAt, event.timeZone, true)}–
                  {date(event.endsAt, event.timeZone, true)}
                </div>
              </div>
              <div className="feature">
                <div className="f-key">会場</div>
                <div className="f-val">{event.venue}</div>
              </div>
              <div className="feature">
                <div className="f-key">聴講</div>
                <div className="f-val">開催案内をご確認ください</div>
              </div>
            </div>
            <div className="content-row">
              <section className="panel sessions-panel">
                <div className="section-head">
                  <h2>発表一覧</h2>
                  <a
                    className="link"
                    href={eventPath + "#schedule"}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(eventPath, "schedule");
                    }}
                  >
                    タイムテーブルを見る
                  </a>
                </div>
                {publicTalks.map((item) => (
                  <a
                    className="talk-card"
                    key={item.id}
                    href={talkLink(item.id)}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(talkLink(item.id));
                    }}
                  >
                    <time className="talk-num">{date(item.startsAt, event.timeZone, true)}</time>
                    <div className="talk-info">
                      <h3>{item.title}</h3>
                      <span className="talk-meta">
                        {item.speakers.map((s) => s.displayName).join("、")}
                        {item.cancelled && " ／ 登壇中止"}
                      </span>
                    </div>
                    <span className="circle-arrow" aria-hidden="true">
                      ›
                    </span>
                  </a>
                ))}
                {publicTalks.length === 0 && <div className="empty">公開中の発表はありません</div>}
              </section>
              <aside className="panel apply-panel">
                <h2>登壇募集</h2>
                <p className="current-state">
                  <span className="tag orange">
                    {applicationsAvailable && event.recruitment === "open"
                      ? "受付中"
                      : "受付期間外"}
                  </span>
                </p>
                <div className="simple-fact">
                  <span>申請・メール確認</span>
                  <strong>
                    {applicationsAvailable ? "メール確認後に申請できます" : "現在利用できません"}
                  </strong>
                </div>
                <div className="simple-fact">
                  <span>お問い合わせ</span>
                  <a href="mailto:panddmail@gmail.com">panddmail@gmail.com</a>
                </div>
                {applicationsAvailable && event.recruitment === "open" ? (
                  <a className="btn coral apply-button" href="/login">
                    登壇申請
                  </a>
                ) : (
                  <button className="btn coral apply-button" disabled>
                    登壇申請（受付期間外）
                  </button>
                )}
              </aside>
            </div>
          </>
        )}
        {valid && page.nextCursor && !selected && (
          <button className="btn pagination" disabled={loading} onClick={() => void more()}>
            次のページ
          </button>
        )}
      </main>
    </div>
  );
}
