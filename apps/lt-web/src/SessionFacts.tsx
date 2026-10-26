import type { TalkContent } from "../../../contracts/lt/v1";
import { sessionFields, relatedFields, difficulties } from "../../../contracts/lt/session-options";

/** @brief 発表日時の下に追加情報を表示する @param props 公開情報 @returns 定義リストの行 */
export function SessionFacts({ session }: { session?: TalkContent["session"] }) {
  const tags = (values: string[] | undefined) =>
    values?.length ? (
      <span className="session-tags">
        {values.map((value) => (
          <span className="session-chip" key={value}>
            {value}
          </span>
        ))}
      </span>
    ) : (
      "未登録"
    );
  return (
    <>
      <div>
        <dt>分野</dt>
        <dd>
          {session ? (
            <span className="session-chip primary">{sessionFields[session.field]}</span>
          ) : (
            "未登録"
          )}
        </dd>
      </div>
      <div>
        <dt>関連分野</dt>
        <dd>{tags(session?.relatedFields.map((key) => relatedFields[key]))}</dd>
      </div>
      <div>
        <dt>キーワード</dt>
        <dd>{tags(session?.keywords)}</dd>
      </div>
      <div>
        <dt>対象プラットフォーム</dt>
        <dd>{tags(session?.platforms)}</dd>
      </div>
      <div>
        <dt>難易度</dt>
        <dd>{session ? difficulties[session.difficulty] : "未登録"}</dd>
      </div>
      <div>
        <dt>求められるスキル</dt>
        <dd className="public-prose">{session?.prerequisites || "未登録"}</dd>
      </div>
      <div>
        <dt>得られる知見</dt>
        <dd className="public-prose">{session?.takeaways || "未登録"}</dd>
      </div>
    </>
  );
}

/** @brief 登壇者が登録した公開リンクを紹介する @param props 公開リンク @returns SNS等へのリンク */
export function SpeakerLinks({ links }: { links?: TalkContent["speakers"][number]["links"] }) {
  if (!links?.length) return null;
  return (
    <ul className="speaker-links" aria-label="SNS・関連リンク">
      {links.map((link, index) => (
        <li key={index}>
          <a href={link.url} target="_blank" rel="noopener noreferrer">
            {link.label}
            <span aria-hidden="true"> ↗</span>
            <span className="link-new-window">（新しいタブ）</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
