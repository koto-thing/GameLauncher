"use client";
import { useEffect, useState } from "react";
import type { EmailChangeStatus } from "../../../../contracts/lt/v1";
import { EmailChangeFlow, type EmailTransport } from "../../lib/lt/email-change-flow";

/** @brief 本人確認から最終確定までを分離して表示する */
export function EmailChangePanel({ applicationId, applicationVersion, transport, onConfirmed }: { applicationId: string; applicationVersion: number; transport?: EmailTransport; onConfirmed?: () => Promise<void> }) {
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState("");
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, render] = useState(0);
  const [flow] = useState(() => new EmailChangeFlow(applicationVersion, transport ?? (async (action, body) => {
    const result = await fetch(`/api/lt/v1/operator/applications/${encodeURIComponent(applicationId)}/email-change${action ? "/"+action : ""}`, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (!result.ok) throw Object.assign(new Error(result.status === 403 ? "Admin・幹部のみ操作できます" : result.status === 409 ? "他の操作で更新されています。再読込してください" : result.status === 501 ? "メール変更APIは未接続です" : `操作できませんでした (${result.status})`), { status: result.status });
    return result.json() as Promise<EmailChangeStatus>;
  })));
  useEffect(() => {
    let active = true;
    void flow.refresh().then(() => { if (active) { setLoaded(true); render(value => value+1); } }).catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : "状態を取得できません"); setDenied(cause?.status === 403); } });
    return () => { active = false; };
  }, [flow]);
  async function run(task: () => Promise<void>, success: string) {
    if (flow.busy) return;
    setBusy(true); setNotice("");
    try { await task(); setError(""); setDenied(false); setLoaded(true); setNotice(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "通信結果を確認できません。再試行は同じ操作として送信します"); if ((cause as {status?:number}).status === 403) setDenied(true); }
    finally { setBusy(false); render(value => value+1); }
  }
  const current = flow.current;
  return <section aria-label="代表者メール変更" aria-busy={busy}><h3>代表者メール変更</h3>
    <p>選択した申請1件だけを変更します。他の開催回は変更しません。確定後は旧アドレスのsessionが失効し、他の申請も再ログインが必要です。</p>
    {error && <p role="alert">{error}</p>}<p role="status">{busy ? "処理中…" : notice}</p>
    <button disabled={busy} onClick={() => void run(() => flow.refresh(), "現在の状態を取得しました")}>変更状態を再読込</button>
    {flow.pending && <><p>結果不明の操作があります。入力を変更しても再試行内容は変わりません。</p><button disabled={busy} onClick={() => void run(() => flow.act(flow.pending!.action), "操作結果を確認しました")}>同じ操作を再試行</button></>}
    {!denied && loaded && <fieldset disabled={busy || flow.blocked || !!flow.pending}><legend>本人確認記録</legend>
      <label>新しいメールアドレス<input type="email" value={email} onInput={e => setEmail(e.currentTarget.value)} /></label>
      <label>本人確認方法<input maxLength={80} value={method} onInput={e => setMethod(e.currentTarget.value)} /></label>
      <label><input type="checkbox" checked={checked} onChange={e => setChecked(e.currentTarget.checked)} />手動で本人確認を行い、確認できました</label>
      <p>方法と確認結果だけを記録します。証明書画像や不要な個人情報は入力しないでください。</p>
      <button disabled={!checked || !method.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} onClick={() => void run(() => flow.act("investigate", { newEmail: email, identityChecked: true, identityCheckMethod: method, identityCheckResult: "confirmed" }), "本人確認を記録しました")}>本人確認を記録</button>
      {current && <><p>変更先: {current.newEmail}</p><p>状態: {({investigating:"本人確認記録済み",verificationPending:"新アドレス確認待ち",verified:"新アドレス確認済み",confirmed:"変更確定・旧session失効",cancelled:"無効"})[current.state]}</p>
      {current.verificationExpiresAt && <p>確認期限: {current.verificationExpiresAt}</p>}
      <button disabled={!["investigating","verificationPending"].includes(current.state)} onClick={() => void run(() => flow.act("send-verification"), "確認リンクの送信を受け付けました。再送の場合、旧未使用リンクは無効です")}>確認リンクを送信・再送</button>
      <button disabled={current.state !== "verified"} onClick={() => void run(async () => { await flow.act("confirm"); await onConfirmed?.(); }, "変更が確定しました。旧アドレスのsessionと未使用ログインリンクは失効しました")}>メール変更を最終確定</button></>}
    </fieldset>}
  </section>;
}
