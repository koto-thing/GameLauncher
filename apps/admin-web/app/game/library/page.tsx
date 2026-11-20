"use client";

import { useEffect, useState } from "react";
import { loginUrl } from "@/lib/login-navigation";

type Edition = { gameId: string; name: string; platform: "windows" | "linux" | "macos"; arch: string;
  version: string | null; requestId: string | null };
const labels = { windows: "Windows", linux: "Linux", macos: "Mac" };

/**
 * 本番配信中のゲームを対象OS別に表示し、選択した版の公開停止を受け付ける
 * @returns 配信一覧と停止理由の入力フォーム
 */
export default function GameLibrary() {
  const [data, setData] = useState<{ games: Edition[]; errors: string[] } | null>(null);
  const [revision, setRevision] = useState(0);
  const [target, setTarget] = useState<Edition | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/game-library", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (response.status === 401) { window.location.assign(loginUrl("/game/library")); return; }
      if (!response.ok) throw new Error("配信一覧を取得できませんでした");
      const library = await response.json();
      if (!controller.signal.aborted) setData(library);
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, [revision]);

  /**
   * 確認済みの停止理由を既存の本番復旧処理に送信する
   * @returns 受付結果が画面に反映されるまでの完了通知
   */
  async function suspend() {
    if (!target || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recover_publication", mode: "suspend", reason, requestId: target.requestId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "公開停止を開始できませんでした");
      setNotice(`${target.name} の${labels[target.platform]}版の公開停止を受け付けました。完了後に一覧を更新してください。`);
      setTarget(null);
      setRevision(value => value + 1);
    } catch (error) { setNotice(error instanceof Error ? error.message : "通信に失敗しました"); }
    finally { setBusy(false); }
  }

  return <main className="game-library">
    <a className="library-back" href="/game">← Game Launcher 管理画面へ</a>
    <header className="library-header">
    <h1>配信中のゲーム</h1>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => { setData(null); setNotice(""); setRevision(value => value + 1); }}>一覧を更新</button>
    </header>
    <p role="status">{notice || (!data && "配信情報を取得中…")}</p>
    {data?.errors.map(error => <p key={error} role="alert">{error}</p>)}
    {data && !data.games.length && !data.errors.length && <p>現在配信中のゲームはありません。</p>}
    {!!data?.games.length && <div className="library-table"><table aria-label="配信中のゲーム一覧"><thead><tr>
      <th>ゲーム名</th><th>対象OS</th><th>CPU</th><th>バージョン</th><th>公開管理</th>
    </tr></thead><tbody>{data.games.map(game => <tr key={`${game.gameId}-${game.platform}-${game.arch}`}>
      <td><strong>{game.name}</strong><br/><small>{game.gameId}</small></td><td>{labels[game.platform]}</td>
      <td>{game.arch}</td><td>{game.version ?? "取得失敗"}</td>
      <td>{game.requestId ? <button className="danger-outline-button" disabled={busy} onClick={() => { setTarget(game); setReason(""); }}>公開停止</button> : "停止対象の公開記録なし"}</td>
    </tr>)}</tbody></table></div>}
    {target && <form className="library-confirm" onSubmit={event => { event.preventDefault(); void suspend(); }}>
      <h2>{target.name} の公開停止</h2>
      <p>{labels[target.platform]} / {target.arch}（{target.version}）をランチャーの配信一覧から外します。</p>
      <label>停止理由（10～500文字）<textarea required minLength={10} maxLength={500} disabled={busy}
        value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="library-actions"><button className="danger-button" type="submit" disabled={busy || reason.trim().length < 10}>この版の公開を停止する</button>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => setTarget(null)}>キャンセル</button></div>
    </form>}
  </main>;
}
