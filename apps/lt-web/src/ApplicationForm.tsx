import { SessionFields, readSession, isSpeakerUrl } from "./SessionFields";
import { useState } from "react";
import type { Application, PublicEventPage, Speaker } from "./types";
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
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          const session = readSession(f);
          if (speakers.some((s) => s.links?.some((link) => !isSpeakerUrl(link.url))))
            throw new Error(
              "SNS・関連リンクには、ユーザー名やパスワードを含まないhttpまたはhttpsのURLを入力してください。",
            );
          setError("");
          save({
            content: {
              session,
              title: String(f.get("title")),
              abstract: String(f.get("abstract")),
              ...(String(f.get("description")).trim()
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
      <h2>{a ? "申請を編集" : "新規申請"}</h2>
      {error && <p role="alert">{error}</p>}
      {!a && (
        <label>
          開催回
          <select name="eventId" required>
            <option value="">選択してください</option>
            {events.items
              .filter((e) => e.recruitment === "open")
              .map((e) => (
                <option value={e.id} key={e.id}>
                  {e.title}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        タイトル
        <input name="title" required defaultValue={a?.content.title} />
      </label>
      <label>
        概要
        <textarea name="abstract" required defaultValue={a?.content.abstract} />
      </label>
      <label>
        説明（任意）
        <textarea name="description" defaultValue={a?.content.description} />
      </label>
      <SessionFields value={a?.content.session} />
      {speakers.map((s, i) => (
        <fieldset key={i}>
          <legend>発表者 {i + 1}</legend>
          {(["displayName", "affiliation", "profile"] as const).map((k) => (
            <label key={k}>
              {{ displayName: "氏名", affiliation: "所属（任意）", profile: "紹介（任意）" }[k]}
              <input
                required={k === "displayName"}
                value={s[k] ?? ""}
                onChange={(e) =>
                  setSpeakers((old) =>
                    old.map((v, n) => (n === i ? { ...v, [k]: e.target.value } : v)),
                  )
                }
              />
            </label>
          ))}
          <fieldset className="speaker-link-fields">
            <legend>SNS・関連リンク（任意・5件まで）</legend>
            <p>公開してよいプロフィール、ポートフォリオ、GitHubなどを登録してください。</p>
            {(s.links ?? []).map((link, j) => (
              <div className="speaker-link-row" key={j}>
                <label>
                  リンク名
                  <input
                    required
                    maxLength={40}
                    value={link.label}
                    placeholder="例：X、GitHub、ポートフォリオ"
                    onChange={(e) => {
                      const value = e.target.value;
                      setSpeakers((items) =>
                        items.map((item, n) =>
                          n === i
                            ? {
                                ...item,
                                links: item.links?.map((l, k) =>
                                  k === j ? { ...l, label: value } : l,
                                ),
                              }
                            : item,
                        ),
                      );
                    }}
                  />
                </label>
                <label>
                  URL
                  <input
                    type="url"
                    required
                    maxLength={2048}
                    pattern="https?://.*"
                    value={link.url}
                    placeholder="https://"
                    onChange={(e) => {
                      const value = e.target.value;
                      setSpeakers((items) =>
                        items.map((item, n) =>
                          n === i
                            ? {
                                ...item,
                                links: item.links?.map((l, k) =>
                                  k === j ? { ...l, url: value } : l,
                                ),
                              }
                            : item,
                        ),
                      );
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSpeakers((items) =>
                      items.map((item, n) =>
                        n === i ? { ...item, links: item.links?.filter((_, k) => k !== j) } : item,
                      ),
                    )
                  }
                >
                  リンクを削除
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={(s.links?.length ?? 0) >= 5}
              onClick={() =>
                setSpeakers((items) =>
                  items.map((item, n) =>
                    n === i
                      ? { ...item, links: [...(item.links ?? []), { label: "", url: "" }] }
                      : item,
                  ),
                )
              }
            >
              リンクを追加
            </button>
          </fieldset>
          <button
            type="button"
            disabled={speakers.length === 1}
            onClick={() => setSpeakers((old) => old.filter((_, n) => n !== i))}
          >
            削除
          </button>
        </fieldset>
      ))}
      <button type="button" onClick={() => setSpeakers((old) => [...old, { displayName: "" }])}>
        発表者を追加
      </button>
      <label>
        資料 URL
        <input
          name="materialUrl"
          type="url"
          required
          defaultValue={a?.materialUrl}
          pattern="https?://.*"
        />
      </label>
      <button disabled={busy}>保存</button>
      <button type="button" disabled={busy} onClick={cancel}>
        中断
      </button>
    </form>
  );
}
