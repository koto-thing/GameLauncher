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
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({
          content: {
            title: String(f.get("title")),
            abstract: String(f.get("abstract")),
            description: String(f.get("description")),
            speakers,
          },
          materialUrl: String(f.get("materialUrl")),
          ...(!a ? { eventId: String(f.get("eventId")) } : {}),
        });
      }}
    >
      <h2>{a ? "申請を編集" : "新規申請"}</h2>
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
