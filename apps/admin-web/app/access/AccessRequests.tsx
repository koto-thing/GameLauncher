"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import type { AccessRequestRow, AccessService } from "@/lib/access-requests";

type Data = {
  user: { login: string; avatarUrl: string } | null;
  requests: AccessRequestRow[]; canReview: boolean;
  games: { id: string; title: string }[];
  githubAuthConfigured: boolean; localDevAuthAvailable: boolean;
};
const states = { pending: "承認待ち", approved: "承認済み", rejected: "却下" };
const grants: Record<string, string> = { requester: "申請者", approver: "承認者", production_requester: "本番申請者" };

/** @brief レスポンス形式にかかわらず利用者向けエラーを取り出す */
async function responseData(response: Response) {
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error(raw || "通信に失敗しました"); }
  if (!response.ok) throw new Error(payload.error ?? "操作を完了できませんでした");
  return payload;
}

/** @brief 本人の利用申請とサービス別の管理者審査を提供する */
export function AccessRequests({ initialService }: { initialService: AccessService }) {
  const [service, setService] = useState<AccessService>(initialService);
  const [review, setReview] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/access-requests?service=${service}&review=${review}`, { cache: "no-store", signal: controller.signal })
      .then(responseData)
      .then((payload: Data) => { if (!controller.signal.aborted) setData(payload); })
      .catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [service, review, version]);

  /** @brief 更新後にサーバーから状態を読み直し、再送可能な失敗は画面に残す */
  async function mutate(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await responseData(await fetch("/api/access-requests", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, service }),
      }));
      setNotice(payload.action === "submit" ? "申請を受け付けました。運営の確認をお待ちください。" : "審査結果を保存しました。");
      setData(null);
      setVersion((value) => value + 1);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作に失敗しました");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** @brief 本人情報を入力値に含めず申請内容だけを送信する */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (await mutate({ action: "submit", displayName: fields.get("displayName"), purpose: fields.get("purpose"), target: fields.get("target") })) form.reset();
  }

  return <section>
    <div className="access-toolbar">
      <label>申請先<select value={service} disabled={busy} onChange={(event) => {
        setService(event.target.value as AccessService); setReview(false); setData(null); setError(""); setNotice("");
      }}><option value="game">GameLauncher</option><option value="music">Music</option></select></label>
      <button type="button" disabled={busy} onClick={() => { setError(""); setVersion((value) => value + 1); }}>状態を更新</button>
      {(review || data?.canReview) && <button type="button" disabled={busy} onClick={() => { setReview(!review); setData(null); setError(""); }}>{review ? "自分の申請へ" : "申請を審査する"}</button>}
    </div>
    {error && <p role="alert">{error} <a href="/api/auth/github/start">GitHubで再ログイン</a></p>}
    {notice && <p role="status">{notice}</p>}
    {!data && !error && <p role="status">読み込み中…</p>}
    {data && !data.user && <div className="service-card"><p>GitHubアカウントでログインしてください。</p>
      {data.githubAuthConfigured && <a className="primary-link" href="/api/auth/github/start">GitHubでログイン</a>}
      {!data.githubAuthConfigured && !data.localDevAuthAvailable && <p>GitHubログインの設定待ちです。運営へお問い合わせください。</p>}
      {data.localDevAuthAvailable && <div className="dev-login"><a href="/api/auth/dev?as=outsider">未登録ユーザー</a><a href="/api/auth/dev?as=admin">ゲーム運営</a><a href="/api/auth/dev?as=music-admin">Music運営</a></div>}
    </div>}
    {data?.user && <>
      <p>ログイン中：@{data.user.login}</p>
      {!review && <form className="access-form" onSubmit={submit}>
        <label>氏名・活動名<input name="displayName" required maxLength={80} autoComplete="name" /></label>
        {service === "music" && <label>担当したい作品名<input name="target" required maxLength={120} /></label>}
        <label>利用目的<textarea name="purpose" required maxLength={1000} rows={3} /></label>
        {service === "game" && <p>ゲーム管理にはリポジトリへのWrite以上の権限も必要です。未設定の場合も申請できます。</p>}
        <button className="primary-button" disabled={busy}>利用を申請する</button>
      </form>}
      <h2>{review ? "申請の審査" : "自分の申請状況"}</h2>
      {!data.requests.length && <p>申請はありません。</p>}
      <p>承認待ちを優先して最新100件を表示します。承認済みの履歴は、現在の権限を保証するものではありません。</p>
      <div className="access-request-list">{data.requests.map((row) => <article className="service-card" key={row.id}>
        <div className="access-identity">{row.avatar_url && <Image src={row.avatar_url} alt="" width={40} height={40} unoptimized referrerPolicy="no-referrer" />}
          <a href={`https://github.com/${encodeURIComponent(row.login)}`} target="_blank" rel="noreferrer">@{row.login}</a><strong>{row.display_name}</strong></div>
        <h3>{row.target} — {states[row.state]}</h3>
        <p className="access-purpose">{row.purpose}</p>
        <small>申請日時：{new Date(row.created_at).toLocaleString("ja-JP")}</small>
        {row.reason && <p>却下理由：{row.reason}</p>}
        {row.grant_type && <p>付与した権限：{grants[row.grant_type]}</p>}
        {row.game_id && <p>付与した作品：{row.game_title ?? "削除された作品"}</p>}
        {row.state === "approved" && <a href={service === "game" ? "/game" : "/music"}>管理画面を開く</a>}
        {review && row.state === "pending" && <ReviewForm row={row} games={data.games} busy={busy} mutate={mutate} />}
      </article>)}</div>
    </>}
  </section>;
}

/** @brief 管理者が付与範囲を明示して審査し、却下には理由を必須にする */
function ReviewForm({ row, games, busy, mutate }: {
  row: AccessRequestRow; games: Data["games"]; busy: boolean;
  mutate: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [grantType, setGrant] = useState("requester");
  const [gameId, setGame] = useState("");
  const [reason, setReason] = useState("");
  return <div className="access-review">
    {row.service === "game" ? <>
      <p>{row.repository_access ? "承認時にリポジトリ権限を再確認します。" : "リポジトリ権限の設定・確認が必要です。設定後に承認してください。"}</p>
      <label>付与する権限<select value={grantType} onChange={(event) => setGrant(event.target.value)}>{Object.entries(grants).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </> : <label>付与する作品<select value={gameId} onChange={(event) => setGame(event.target.value)}><option value="">作品を選択</option>{games.map((game) => <option key={game.id} value={game.id}>{game.title || game.id}</option>)}</select></label>}
    <button disabled={busy || (row.service === "music" && !gameId)} onClick={() => void mutate({ action: "decide", id: row.id, decision: "approved", grantType, gameId })}>承認して権限を付与</button>
    <label>却下理由<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
    <button disabled={busy || !reason.trim()} onClick={() => void mutate({ action: "decide", id: row.id, decision: "rejected", reason })}>却下する</button>
  </div>;
}
