import { SessionFields, readSession, isSpeakerUrl } from "./SessionFields";
import { useState } from "react";
import {
  FileText,
  Tags,
  Users,
  Link,
  Plus,
  Trash2,
  Send,
  Save,
  ArrowLeft,
  Paperclip,
} from "lucide-react";
import type { Application, PublicEventPage, Speaker } from "./types";
import "./application.css";

/** @brief 発表内容と登壇者情報を入力する @param props 申請と保存操作 @returns 申請フォーム */
export function ApplicationForm({
  application: a,
  events,
  busy,
  save,
  cancel,
}: {
  application: Application | null;
  events: PublicEventPage;
  busy: boolean;
  save: (data: unknown) => void;
  cancel: () => void;
}) {
  const [speakers, setSpeakers] = useState<Speaker[]>(a?.content.speakers ?? [{ displayName: "" }]);
  const [error, setError] = useState("");
  const openEvents = events.items.filter((e) => e.recruitment === "open");

  // 対象の登壇者だけを更新する
  function changeSpeaker(index: number, update: Partial<Speaker>) {
    setSpeakers((items) => items.map((item, i) => (i === index ? { ...item, ...update } : item)));
  }

  return (
    <form
      className="application-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          const session = readSession(f);
          if (
            speakers.some((s) =>
              s.links?.some((link) => !link.label.trim() || !isSpeakerUrl(link.url)),
            )
          )
            throw new Error("リンク名とhttpまたはhttpsのURLを入力してください。");
          setError("");
          save({
            content: {
              session,
              title: String(f.get("title")),
              abstract: String(f.get("abstract")),
              ...(String(f.get("description") ?? "").trim()
                ? { description: String(f.get("description")) }
                : {}),
              speakers: speakers.map((s) => ({
                displayName: s.displayName,
                ...(s.links?.length
                  ? {
                      links: s.links.map((link) => ({
                        label: link.label.trim(),
                        url: link.url.trim(),
                      })),
                    }
                  : {}),
                ...(s.affiliation?.trim() ? { affiliation: s.affiliation } : {}),
                ...(s.profile?.trim() ? { profile: s.profile } : {}),
              })),
            },
            materialUrl: String(f.get("materialUrl")),
            ...(!a ? { eventId: String(f.get("eventId")) } : {}),
          });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "入力内容を確認してください");
        }
      }}
    >
      <div className="application-heading">
        <div>
          <h1>{a ? "申請を編集" : "登壇申請"}</h1>
        </div>
        <span className="required-guide">＊ 必須</span>
      </div>
      {error && <p role="alert">{error}</p>}
      <fieldset className="application-body" disabled={busy}>
        <section className="application-card" aria-labelledby="talk-content-title">
          <h2 id="talk-content-title">
            <FileText aria-hidden="true" />
            発表内容
          </h2>
          {!a && (
            <label className="required-field">
              開催回
              <select name="eventId" required defaultValue="">
                <option value="">開催回を選択</option>
                {openEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="required-field">
            発表タイトル
            <input
              name="title"
              required
              defaultValue={a?.content.title}
              placeholder="何について話しますか？"
            />
          </label>
          <label className="required-field">
            概要
            <textarea
              name="abstract"
              required
              defaultValue={a?.content.abstract}
              placeholder="発表する内容を簡潔に紹介してください"
              rows={3}
            />
          </label>
          <details className="application-extra" open={a?.content.description ? true : undefined}>
            <summary>詳しい説明を追加</summary>
            <label>
              発表の詳細
              <textarea name="description" defaultValue={a?.content.description} rows={4} />
            </label>
          </details>
        </section>
        <section className="application-card" aria-labelledby="talk-session-title">
          <h2 id="talk-session-title">
            <Tags aria-hidden="true" />
            分類・対象者
          </h2>
          <SessionFields value={a?.content.session} />
        </section>
        <section className="application-card" aria-labelledby="talk-speakers-title">
          <h2 id="talk-speakers-title">
            <Users aria-hidden="true" />
            登壇者・リンク
          </h2>
          {speakers.map((s, i) => (
            <fieldset className="application-speaker" key={i}>
              <legend>登壇者 {i + 1}</legend>
              {speakers.length > 1 && (
                <button
                  className="icon-button remove-speaker"
                  type="button"
                  aria-label={`登壇者${i + 1}を削除`}
                  title="登壇者を削除"
                  onClick={() => setSpeakers((items) => items.filter((_, n) => n !== i))}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              )}
              <div className="application-columns">
                <label className="required-field">
                  名前
                  <input
                    required
                    value={s.displayName}
                    placeholder="公開する名前"
                    onChange={(e) => changeSpeaker(i, { displayName: e.target.value })}
                  />
                </label>
                <label>
                  所属
                  <input
                    value={s.affiliation ?? ""}
                    placeholder="サークル・学校・会社など"
                    onChange={(e) => changeSpeaker(i, { affiliation: e.target.value })}
                  />
                </label>
              </div>
              <label>
                プロフィール
                <textarea
                  rows={2}
                  value={s.profile ?? ""}
                  placeholder="活動や興味のあることなど"
                  onChange={(e) => changeSpeaker(i, { profile: e.target.value })}
                />
              </label>
              <div className="application-links">
                <h3>
                  <Link aria-hidden="true" />
                  SNS・関連リンク
                </h3>
                {(s.links ?? []).map((link, j) => (
                  <div className="application-link-row" key={j}>
                    <input
                      aria-label={`登壇者${i + 1}のリンク${j + 1}の名前`}
                      required
                      maxLength={40}
                      value={link.label}
                      placeholder="X・GitHubなど"
                      onChange={(e) =>
                        changeSpeaker(i, {
                          links: s.links?.map((item, n) =>
                            n === j ? { ...item, label: e.target.value } : item,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={`登壇者${i + 1}のリンク${j + 1}のURL`}
                      type="url"
                      required
                      pattern="https?://.*"
                      maxLength={2048}
                      value={link.url}
                      placeholder="https://"
                      onChange={(e) =>
                        changeSpeaker(i, {
                          links: s.links?.map((item, n) =>
                            n === j ? { ...item, url: e.target.value } : item,
                          ),
                        })
                      }
                    />
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`リンク${j + 1}を削除`}
                      title="リンクを削除"
                      onClick={() =>
                        changeSpeaker(i, { links: s.links?.filter((_, n) => n !== j) })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <button
                  className="quiet-button"
                  type="button"
                  disabled={(s.links?.length ?? 0) >= 5}
                  onClick={() =>
                    changeSpeaker(i, { links: [...(s.links ?? []), { label: "", url: "" }] })
                  }
                >
                  <Plus aria-hidden="true" />
                  リンクを追加
                </button>
              </div>
            </fieldset>
          ))}
          <button
            className="quiet-button"
            type="button"
            onClick={() => setSpeakers((items) => [...items, { displayName: "" }])}
          >
            <Plus aria-hidden="true" />
            発表者を追加
          </button>
        </section>
        <section className="application-card" aria-labelledby="talk-material-title">
          <h2 id="talk-material-title">
            <Paperclip aria-hidden="true" />
            発表資料
          </h2>
          <label className="required-field">
            資料URL
            <input
              name="materialUrl"
              type="url"
              required
              defaultValue={a?.materialUrl}
              pattern="https?://.*"
              placeholder="https://"
            />
          </label>
        </section>
        <div className="application-actions">
          <button type="button" className="quiet-button" onClick={cancel}>
            <ArrowLeft aria-hidden="true" />
            戻る
          </button>
          <button type="submit" className="primary-button">
            {a ? <Save aria-hidden="true" /> : <Send aria-hidden="true" />}
            {busy ? "送信中…" : a ? "変更を保存" : "申請する"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
