import type { PublicEvent, PublicTalk } from "../../../contracts/lt/v1";
import { ArrowUpRight, CalendarDays, LayoutGrid, Presentation } from "lucide-react";
import uploadedMaterials from "../../../contracts/lt/uploaded-materials.json";
import { sessionFields } from "../../../contracts/lt/session-options";
import { publicDate, durationMinutes, followPublicLink } from "./public-display";

const kinds = {
  opening: "オープニング",
  break: "休憩",
  closing: "交流会",
  transition: "転換",
  talk: "発表",
};
export type ScheduleView = "table" | "list";
const uploaded: Record<string, { baseUrl: string }[]> = uploadedMaterials;

/**
 * 公開資料に対応する表紙画像を取得する
 * @param url 発表の資料URL
 * @returns 表紙画像のURL、登録がない場合はundefined
 */
function thumbnail(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const deck = uploaded[url]?.[0];
  if (deck) return `${deck.baseUrl}page-001.jpg`;
  if (
    url.startsWith(
      "https://docs.google.com/presentation/d/15hXCVW6MakXyiKYaB6EUD01ukjuJ9-DZVdKix_pktXU/",
    )
  ) {
    return "/materials/koto/thumbnail.png";
  }
  return undefined;
}

/**
 * 公開時間割を時刻軸または発表一覧で表示する
 * @param props 開催回、公開発表、表示形式と画面遷移の処理
 * @returns 時間割または発表だけを掲載したサムネイル付きカード一覧
 */
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
          <h1 id="program-title">{view === "list" ? "発表一覧" : "タイムテーブル"}</h1>
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
            <CalendarDays size={18} aria-hidden="true" /> タイムテーブル
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => onViewChange("list")}>
            <LayoutGrid size={18} aria-hidden="true" /> 一覧表示
          </button>
        </div>
      </div>
      {event.schedule.length === 0 ? (
        <div className="empty">時間割は未設定です。</div>
      ) : view === "list" ? (
        <div className="program-cards program-list" aria-label="発表一覧表示">
          {/* 一覧は発表のみを開催順に並べ、時刻や補助枠は掲載しない */}
          {event.schedule
            .filter((block) => block.kind === "talk" && block.talkId)
            .map((block) => {
              const talk = talks[block.talkId!];
              const href = `${eventPath}/talks/${encodeURIComponent(block.talkId!)}?list=1`;
              const image = thumbnail(talk?.materialUrl);
              return (
                <a
                  key={block.id}
                  className="program-card"
                  href={href}
                  onClick={(e) => followPublicLink(e, href, navigate)}
                >
                  <div className="program-card-thumbnail">
                    {image ? (
                      <img src={image} alt="" loading="lazy" width={1440} height={810} />
                    ) : (
                      <Presentation size={48} aria-hidden="true" />
                    )}
                  </div>
                  <div className="program-card-copy">
                    {talk?.cancelled && <span className="tag red">登壇中止</span>}
                    <h2>{talk?.title ?? "発表詳細を確認する"}</h2>
                    <p>{talk?.speakers.map((speaker) => speaker.displayName).join("、")}</p>
                    <ArrowUpRight className="program-card-arrow" size={20} aria-hidden="true" />
                  </div>
                </a>
              );
            })}
        </div>
      ) : (
        <div className="program-body program-table" aria-label="タイムテーブル表示">
          {view === "table" && (
            <div className="program-room">
              <span>時刻</span>
              <strong>{event.venue}</strong>
            </div>
          )}
          {/* 連続する発表の間に置かれた0分の転換枠は表示しない */}
          {event.schedule
            .filter((block) => block.startsAt !== block.endsAt)
            .map((block) => {
              const talk = block.talkId ? talks[block.talkId] : undefined;
              const minutes = durationMinutes(block.startsAt, block.endsAt);
              const href = block.talkId
                ? `${eventPath}/talks/${encodeURIComponent(block.talkId)}?list=0`
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
                  </div>
                  <h2>{talk?.title ?? "発表詳細を確認する"}</h2>
                  <p className="program-speakers">
                    {talk?.speakers
                      .map((s) => s.displayName + (s.affiliation ? ` / ${s.affiliation}` : ""))
                      .join("、")}
                  </p>
                  <span className="program-more">
                    発表詳細 <ArrowUpRight size={16} aria-hidden="true" />
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
      {view === "table" && (
        <p className="small muted schedule-note">
          時刻は{event.timeZone === "Asia/Tokyo" ? "日本時間（JST）" : event.timeZone}
          です。スケジュールは変更になる場合があります。
        </p>
      )}
    </section>
  );
}
