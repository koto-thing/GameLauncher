import type { PublicEvent, PublicTalk } from "../../../contracts/lt/v1";
import { sessionFields } from "../../../contracts/lt/session-options";
import { publicDate, durationMinutes, followPublicLink } from "./public-display";

const kinds = { opening: "開会", break: "休憩", closing: "閉会", transition: "転換", talk: "発表" };
export type ScheduleView = "table" | "list";

/** @brief 公開時間割を時刻軸または発表一覧で表示する @param props 開催回と公開発表 @returns 時間割画面 */
export function PublicSchedule({
  event,
  talks,
  view,
  onViewChange,
  navigate,
}: {
  event: PublicEvent;
  talks: Record<string, PublicTalk>;
  view: ScheduleView;
  onViewChange: (view: ScheduleView) => void;
  navigate: (href: string) => void;
}) {
  const eventPath = `/events/${encodeURIComponent(event.id)}`;
  return (
    <section className="program" aria-labelledby="program-title">
      <div className="page-head program-heading">
        <div>
          <p className="program-eyebrow">{event.title}</p>
          <h1 id="program-title">タイムテーブル</h1>
          <p>発表を選ぶと、内容と登壇者の詳細をご覧いただけます。</p>
        </div>
      </div>
      <div className="program-toolbar">
        <div className="program-date">
          <strong>{publicDate(event.startsAt, event.timeZone)}</strong>
          <span>{event.venue}</span>
        </div>
        <div className="program-switch" role="group" aria-label="表示形式">
          <button
            type="button"
            aria-pressed={view === "table"}
            onClick={() => onViewChange("table")}
          >
            <span aria-hidden="true">▦</span> タイムテーブル
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => onViewChange("list")}>
            <span aria-hidden="true">☷</span> 一覧表示
          </button>
        </div>
      </div>
      {event.schedule.length === 0 ? (
        <div className="empty">時間割は未設定です。</div>
      ) : (
        <div
          className={`program-body program-${view}`}
          aria-label={view === "table" ? "タイムテーブル表示" : "発表一覧表示"}
        >
          {view === "table" && (
            <div className="program-room">
              <span>時刻</span>
              <strong>{event.venue}</strong>
            </div>
          )}
          {event.schedule.map((block) => {
            const talk = block.talkId ? talks[block.talkId] : undefined;
            const minutes = durationMinutes(block.startsAt, block.endsAt);
            const href = block.talkId
              ? `${eventPath}/talks/${encodeURIComponent(block.talkId)}?list=${view === "list" ? 1 : 0}`
              : "";
            const content = (
              <>
                <div className="program-meta">
                  <span className={`program-field field-${talk?.session?.field ?? "unset"}`}>
                    {talk?.session ? sessionFields[talk.session.field] : "分野未登録"}
                  </span>
                  <span className={`tag ${talk?.cancelled ? "red" : ""}`}>
                    {talk?.cancelled ? "登壇中止" : "LT"}
                  </span>
                  <span>{minutes}分</span>
                  {view === "list" && <span>{event.venue}</span>}
                </div>
                <h2>{talk?.title ?? "発表詳細を確認する"}</h2>
                <p className="program-speakers">
                  {talk?.speakers
                    .map((s) => s.displayName + (s.affiliation ? ` / ${s.affiliation}` : ""))
                    .join("、")}
                </p>
                {view === "list" && talk?.abstract && (
                  <p className="program-excerpt">{talk.abstract}</p>
                )}
                <span className="program-more">
                  発表詳細 <span aria-hidden="true">↗</span>
                </span>
              </>
            );
            return (
              <div
                key={block.id}
                className={`program-row ${block.kind === "talk" ? "session" : "interval"}`}
                style={view === "table" ? { minHeight: Math.max(54, minutes * 13) } : undefined}
              >
                <div className="program-time">
                  <time dateTime={block.startsAt}>
                    {publicDate(block.startsAt, event.timeZone, true)}
                  </time>
                  <span>– {publicDate(block.endsAt, event.timeZone, true)}</span>
                  {publicDate(block.startsAt, event.timeZone) !==
                    publicDate(event.startsAt, event.timeZone) && (
                    <small>{publicDate(block.startsAt, event.timeZone)}</small>
                  )}
                </div>
                {block.kind === "talk" && href ? (
                  <a
                    className={`program-session field-${talk?.session?.field ?? "unset"}${talk?.cancelled ? " cancelled" : ""}`}
                    href={href}
                    onClick={(e) => followPublicLink(e, href, navigate)}
                  >
                    {content}
                  </a>
                ) : (
                  <div className="program-interval">
                    <strong>{kinds[block.kind]}</strong>
                    <span>{minutes}分</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="small muted schedule-note">
        時刻は{event.timeZone === "Asia/Tokyo" ? "日本時間（JST）" : event.timeZone}
        です。スケジュールは変更になる場合があります。
      </p>
    </section>
  );
}
