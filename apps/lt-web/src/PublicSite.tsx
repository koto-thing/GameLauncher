import { useEffect, useState } from "react";
import type { PublicEvent, PublicEventPage, PublicTalk } from "../../../contracts/lt/v1";
import { request } from "./api";
import { isPublicPage, unavailableMessage } from "./availability";
import "./public.css";

const tabs = [
  ["home", "開催案内"],
  ["schedule", "タイムテーブル"],
  ["archive", "過去の開催"],
  ["about", "参加・お問い合わせ"],
] as const;
type Tab = (typeof tabs)[number][0];
const kinds = { opening: "開会", break: "休憩", closing: "閉会", transition: "入替", talk: "発表" };

/** 公開DTOだけを取得し、開発用データは本番bundleから除外する */
async function read<T>(path: string): Promise<T> {
  if (import.meta.env.DEV && import.meta.env.VITE_LT_FIXTURE === "true")
    return (await import("./fixture")).fixture<T>(path);
  return request<T>(path);
}

/** 開催回のタイムゾーンで日時を表示する */
function date(value: string, zone: string, time = false) {
  return new Intl.DateTimeFormat(
    "ja-JP",
    time
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }
      : { year: "numeric", month: "long", day: "numeric", weekday: "short", timeZone: zone },
  ).format(new Date(value));
}

/** モックの公開レイアウトを実データへ接続し、申請経路は開かない */
export function PublicSite() {
  const [path, setPath] = useState(location.pathname);
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
  const valid = isPublicPage(path);
  const event =
    selected ??
    [...page.items]
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .find((item) => Date.parse(item.endsAt) >= Date.now()) ??
    null;
  const eventPath = event ? "/events/" + encodeURIComponent(event.id) : "/";

  // 戻る・直接URLでも同じ公開画面を表示する
  useEffect(() => {
    const sync = () => {
      setPath(location.pathname);
      setTab(
        tabs.some(([key]) => key === location.hash.slice(1))
          ? (location.hash.slice(1) as Tab)
          : "home",
      );
    };
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
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
  function navigate(next: string, nextTab: Tab = "home") {
    history.pushState(null, "", next + (nextTab === "home" ? "" : "#" + nextTab));
    setPath(next);
    setTab(nextTab);
  }

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
  const talkLink = (id: string) => eventPath + "/talks/" + encodeURIComponent(id);
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
            <strong className="brand-title">Aizu LT</strong>
          </a>
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
            className={tab === key ? "active" : ""}
            aria-current={tab === key ? "page" : undefined}
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
        <p className="notice unavailable" role="status">
          {unavailableMessage}
        </p>
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
          <section className="panel talk-detail">
            <a
              className="link"
              href={eventPath}
              onClick={(e) => {
                e.preventDefault();
                navigate(eventPath);
              }}
            >
              開催案内に戻る
            </a>
            <h1>{talk.title}</h1>
            {talk.cancelled && (
              <p className="tag red" role="status">
                登壇中止
              </p>
            )}
            <div className="talk-summary">
              <p>
                <strong>登壇者：</strong>
                {talk.speakers.map((s) => s.displayName).join("、")}
              </p>
              <p>
                <strong>発表時刻：</strong>
                {date(talk.startsAt, event.timeZone, true)}–
                {date(talk.endsAt, event.timeZone, true)}
              </p>
            </div>
            <div className="divider" />
            <h2>発表概要</h2>
            <p className="public-prose">{talk.abstract}</p>
            {talk.description && <p className="public-prose">{talk.description}</p>}
            {talk.speakers.map((speaker, index) => (
              <p key={index}>
                {speaker.displayName}
                {speaker.affiliation && " / " + speaker.affiliation}
                {speaker.profile && " — " + speaker.profile}
              </p>
            ))}
          </section>
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
                <p className="muted small">登壇申請・メール確認は現在停止しています。</p>
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
          <>
            <div className="page-head">
              <div>
                <h1>タイムテーブル</h1>
                <p>
                  {date(event.startsAt, event.timeZone)} ／ {event.venue}
                </p>
              </div>
            </div>
            <div className="schedule-table">
              {event.schedule.map((block) => (
                <div
                  className={"schedule-item" + (block.kind === "talk" ? "" : " minor")}
                  key={block.id}
                >
                  <time className="schedule-time">
                    {date(block.startsAt, event.timeZone, true)}
                  </time>
                  <div className="schedule-main">
                    <h2>
                      {block.talkId
                        ? (talks[block.talkId]?.title ?? "発表情報を確認中")
                        : kinds[block.kind]}
                    </h2>
                    {block.talkId && (
                      <p className="muted small">
                        {talks[block.talkId]?.speakers.map((s) => s.displayName).join("、")}
                      </p>
                    )}
                  </div>
                  <div className="schedule-kind">
                    {block.talkId && (
                      <a
                        className="btn sm"
                        href={talkLink(block.talkId)}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(talkLink(block.talkId!));
                        }}
                      >
                        発表詳細
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {event.schedule.length === 0 && <div className="empty">時間割は未設定です。</div>}
            <p className="small muted schedule-note">時刻は{event.timeZone}で表示しています。</p>
          </>
        ) : (
          <>
            <section className="hero">
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
                  <button className="btn" disabled>
                    登壇申請（受付停止中）
                  </button>
                </div>
              </div>
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
            {event.guidance && <p className="event-guidance public-prose">{event.guidance}</p>}
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
                  <span className="tag orange">受付停止中</span>
                </p>
                <div className="simple-fact">
                  <span>申請・メール確認</span>
                  <strong>現在利用できません</strong>
                </div>
                <div className="simple-fact">
                  <span>お問い合わせ</span>
                  <a href="mailto:panddmail@gmail.com">panddmail@gmail.com</a>
                </div>
                <button className="btn coral apply-button" disabled>
                  登壇申請（受付停止中）
                </button>
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
      <footer className="footer">
        <div className="container foot">
          <div>
            <strong>Aizu LT</strong>
            <span>開催案内・公開発表</span>
          </div>
          <a href="mailto:panddmail@gmail.com">panddmail@gmail.com</a>
        </div>
      </footer>
    </div>
  );
}
