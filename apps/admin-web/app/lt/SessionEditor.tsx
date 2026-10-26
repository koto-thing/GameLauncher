"use client";
import { useState } from "react";
import type { OperatorApplication, Speaker, TalkContent } from "../../../../contracts/lt/v1";
import { SessionFields, readSession, isSpeakerUrl } from "../../../lt-web/src/SessionFields";

type Metadata = { session: NonNullable<TalkContent["session"]>; speakerLinks: NonNullable<Speaker["links"]>[] };

/** @brief 承認済み発表の追加情報を編集する @param props 申請と保存処理 @returns 編集フォーム */
export function SessionEditor({ application, onSave }: { application: OperatorApplication; onSave: (data: Metadata, done: () => void) => void }) {
  const [editing, setEditing] = useState(false);
  const [links, setLinks] = useState(() => application.content.speakers.map(s => s.links ?? []));
  const [error, setError] = useState("");
  if (!editing) return <button type="button" onClick={() => setEditing(true)}>発表情報を編集</button>;

  // 登壇者ごとのリンクを更新し、他の登壇者の入力を維持する
  function change(index: number, value: NonNullable<Speaker["links"]>) {
    setLinks(current => current.map((item, i) => i === index ? value : item));
  }

  return <form className="lt-session-editor" onSubmit={e => {
    e.preventDefault();
    try {
      const session = readSession(new FormData(e.currentTarget));
      const speakerLinks = links.map(items => items.map(link => ({label: link.label.trim(), url: link.url.trim()})));
      if (speakerLinks.some(items => items.some(link => !link.label || !isSpeakerUrl(link.url)))) throw new Error("リンク名とhttpまたはhttpsのURLを入力してください。");
      setError("");
      onSave({session, speakerLinks}, () => setEditing(false));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "入力を確認してください"); }
  }}>
    <h3>発表情報を編集</h3>
    <p>保存すると公開ページにも反映されます。発表タイトル・本文・日時・承認状況は変更されません。</p>
    {error && <p role="alert">{error}</p>}
    <SessionFields value={application.content.session} />
    {application.content.speakers.map((speaker, index) => <fieldset key={index}>
      <legend>{speaker.displayName} のSNS・関連リンク</legend>
      <p>公開してよいリンクを5件まで登録できます。</p>
      {links[index].map((link, n) => <div className="lt-speaker-link-editor" key={n}>
        <label>リンク名<input required maxLength={40} value={link.label} onChange={e => change(index, links[index].map((item, i) => i === n ? {...item,label:e.target.value} : item))} /></label>
        <label>URL<input required type="url" pattern="https?://.*" maxLength={2048} value={link.url} onChange={e => change(index, links[index].map((item, i) => i === n ? {...item,url:e.target.value} : item))} /></label>
        <button type="button" onClick={() => change(index, links[index].filter((_, i) => i !== n))}>リンクを削除</button>
      </div>)}
      <button type="button" disabled={links[index].length >= 5} onClick={() => change(index, [...links[index],{label:"",url:""}])}>リンクを追加</button>
    </fieldset>)}
    <button type="submit">保存して公開に反映</button>
    <button type="button" onClick={() => { setLinks(application.content.speakers.map(s => s.links ?? [])); setError(""); setEditing(false); }}>編集を取り消す</button>
  </form>;
}
