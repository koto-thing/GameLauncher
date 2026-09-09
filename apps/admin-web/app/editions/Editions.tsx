"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Dashboard = {
  games: { id: string; name: string; available: boolean; reason: string }[];
  editions: { edition_id: string; definition: { name: string; games: string[] }; created_at: string }[];
  builds: { build_id: string; edition_id: string; state: string; run_id: string | null; artifact_id: string | null;
    snapshot_json: string | null; error: string | null; created_at: string }[];
  dispatchConfigured: boolean;
};
const labels: Record<string, string> = { queued: "Actions待機中", running: "ビルド中", succeeded: "完成", failed: "失敗", cancelled: "キャンセル" };

/** @brief 固定配布版の作成、ビルド、成果物取得を提供する */
export function Editions() {
  const [data, setData] = useState<Dashboard>();
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#e60012");

  // 実行中ビルドがある間だけ一覧を更新する
  const refresh = useCallback(async () => {
    const response = await fetch("/api/editions", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setData(body);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/editions", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        setNeedsLogin(response.status === 401 || response.status === 403);
        if (!response.ok) throw new Error(body.error);
        return body as Dashboard;
      })
      .then(setData)
      .catch((failure) => { if (!controller.signal.aborted) setError(String(failure)); });
    return () => controller.abort();
  }, []);
  const running = data?.builds.some((build) => ["queued", "running"].includes(build.state));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { refresh().catch((failure) => setError(String(failure))); }, 15000);
    return () => clearInterval(timer);
  }, [running, refresh]);

  /** @brief 独立したWindowsビルドを開始する */
  async function build(id: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/editions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ editionId: id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setNotice("Windows配布版のビルドを開始しました");
      await refresh();
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }

  /** @brief ゲームとデザインを変更不可の配布版として保存する */
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = new FormData(form);
      payload.set("definition", JSON.stringify({ name, accentColor: color, games: selected }));
      const response = await fetch("/api/editions", { method: "POST", body: payload });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setNotice("配布版を作成しました。下の一覧からビルドできます");
      form.reset(); setName(""); setSelected([]);
      await refresh();
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }

  return <main className="edition-manager">
    <header><p>WINDOWS · PHYSICAL DISTRIBUTION</p><h1>物理配布版ランチャー</h1>
      <p>収録ゲームと専用デザインを固定して、オフラインで遊べる配布物を作成します</p></header>
    {error && <p role="alert" className="edition-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!data ? (needsLogin ? <p>管理者としてログインすると利用できます。<a href="/api/auth/github/start">GitHubでログイン</a></p> : <p>{error ? "一覧を取得できませんでした。ページを再読み込みしてください" : "ゲーム一覧を読み込んでいます…"}</p>) : <>
      <form onSubmit={create} className="edition-panel">
        <h2>新しい配布版</h2>
        <label>配布版の名前<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="コミケ冬2026版" /></label>
        <div className="edition-design">
          <label>ロゴ（PNG・2 MiB以内）<input name="logo" type="file" accept="image/png" required /></label>
          <label>背景（PNG・2 MiB以内）<input name="background" type="file" accept="image/png" required /></label>
          <label>アクセントカラー<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        </div>
        <fieldset><legend>収録ゲーム（{selected.length}本選択）</legend>
          {data.games.map((game) => <label key={game.id} className="edition-game">
            <input type="checkbox" disabled={!game.available || busy} checked={selected.includes(game.id)}
              onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, game.id] : ids.filter((id) => id !== game.id))} />
            <span>{game.name}<small>{game.available ? game.id : game.reason}</small></span>
          </label>)}
          {!data.games.length && <p>管理中のゲームはありません</p>}
        </fieldset>
        <p>作成後は収録対象とデザインを固定します。ビルド開始時の最新本番公開版を同梱します</p>
        <button disabled={busy || !selected.length} type="submit">この内容で配布版を作成</button>
      </form>
      <h2>配布版とビルド履歴</h2>
      {!data.dispatchConfigured && <p role="status">Production Actionsの設定後にビルドできます</p>}
      {data.editions.map((edition) => <section className="edition-panel" key={edition.edition_id}>
        <h3>{edition.definition.name}</h3><p>{edition.definition.games.join(" / ")}</p>
        <button disabled={busy || !data.dispatchConfigured} onClick={() => build(edition.edition_id)}>Windows配布物をビルド</button>
        {data.builds.filter((build) => build.edition_id === edition.edition_id).map((build) => <article className="edition-build" key={build.build_id}>
          <strong>{labels[build.state] ?? build.state}</strong> <time>{new Date(build.created_at).toLocaleString("ja-JP")}</time>
          {build.run_id && <a href={`https://github.com/koto-thing/GameLauncher/actions/runs/${build.run_id}`} target="_blank" rel="noreferrer">Actionsを開く</a>}
          {build.artifact_id && build.run_id && <a href={`https://github.com/koto-thing/GameLauncher/actions/runs/${build.run_id}/artifacts/${build.artifact_id}`} target="_blank" rel="noreferrer">配布物をダウンロード</a>}
          {build.snapshot_json && <details><summary>同梱バージョン</summary><pre>{JSON.stringify(JSON.parse(build.snapshot_json), null, 2)}</pre></details>}
          {build.error && <p className="edition-error">{build.error}</p>}
        </article>)}
      </section>)}
    </>}
  </main>;
}
