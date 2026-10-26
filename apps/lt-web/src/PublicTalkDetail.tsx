import type { PublicEvent, PublicTalk } from "../../../contracts/lt/v1";
import { publicDate, durationMinutes, followPublicLink } from "./public-display";
import type { ScheduleView } from "./PublicSchedule";

/** @brief 公開済みの発表内容と登壇者情報を案内する @param props 発表と開催回 @returns 発表詳細 */
export function PublicTalkDetail({
  talk,
  event,
  view,
  navigate,
}: {
  talk: PublicTalk;
  event: PublicEvent;
  view: ScheduleView;
  navigate: (href: string) => void;
}) {
  const eventPath = `/events/${encodeURIComponent(event.id)}`;
  const returnHref = `${eventPath}?list=${view === "list" ? 1 : 0}#schedule`;
  const back = view === "list" ? "発表一覧に戻る" : "タイムテーブルに戻る";
  return (
    <div className="session-detail">
      <nav className="session-breadcrumbs" aria-label="パンくず">
        <a href={eventPath} onClick={(e) => followPublicLink(e, eventPath, navigate)}>
          開催案内
        </a>
        <span aria-hidden="true">/</span>
        <a href={returnHref} onClick={(e) => followPublicLink(e, returnHref, navigate)}>
          タイムテーブル・発表一覧
        </a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">発表詳細</span>
      </nav>
      <section className="session-hero">
        <div className="session-meta">
          <span className="event-state">LT / {durationMinutes(talk.startsAt, talk.endsAt)}分</span>
          <span>{publicDate(talk.startsAt, event.timeZone)}</span>
          <strong>
            {publicDate(talk.startsAt, event.timeZone, true)}–
            {publicDate(talk.endsAt, event.timeZone, true)}
          </strong>
          <span>{event.venue}</span>
        </div>
        <h1>{talk.title}</h1>
        {talk.cancelled && (
          <p className="notice" role="status">
            この発表は登壇中止となりました。
          </p>
        )}
        <p className="session-byline">{talk.speakers.map((s) => s.displayName).join(" / ")}</p>
        <dl className="session-facts">
          <div>
            <dt>開催回</dt>
            <dd>{event.title}</dd>
          </div>
          <div>
            <dt>会場</dt>
            <dd>{event.venue}</dd>
          </div>
          <div>
            <dt>発表日時</dt>
            <dd>
              {publicDate(talk.startsAt, event.timeZone)}
              <br />
              {publicDate(talk.startsAt, event.timeZone, true)}–
              {publicDate(talk.endsAt, event.timeZone, true)}{" "}
              <small>
                （{event.timeZone === "Asia/Tokyo" ? "日本時間 / JST" : event.timeZone}）
              </small>
            </dd>
          </div>
        </dl>
      </section>
      <section className="session-section">
        <h2>発表概要</h2>
        <p className="public-prose">{talk.abstract}</p>
      </section>
      {talk.description && (
        <section className="session-section">
          <h2>発表内容</h2>
          <p className="public-prose">{talk.description}</p>
        </section>
      )}
      <section className="session-section">
        <h2>登壇者</h2>
        <div className="session-speaker-list">
          {talk.speakers.map((speaker, index) => (
            <div className="session-speaker" key={index}>
              <span className="speaker-monogram" aria-hidden="true">
                {Array.from(speaker.displayName)[0]}
              </span>
              <div>
                <h3>{speaker.displayName}</h3>
                {speaker.affiliation && <p className="muted">{speaker.affiliation}</p>}
                {speaker.profile && (
                  <p className="public-prose speaker-profile">{speaker.profile}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="session-back">
        <a
          className="btn"
          href={returnHref}
          onClick={(e) => followPublicLink(e, returnHref, navigate)}
        >
          ← {back}
        </a>
      </div>
    </div>
  );
}
