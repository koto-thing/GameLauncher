"use client";

import { useEffect, useState, type FormEvent } from "react";
import { analyticsCsv, analyticsQuery, type AnalyticsReport, type GameAnalytics, type RetentionMetric } from "@/lib/analytics";

const numberFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 });

/** @brief 観測済み実行秒を読みやすい時間へ変換する */
function duration(seconds: number | null): string {
  if (seconds === null) return "保存期間外";
  if (seconds < 60) return `${numberFormat.format(seconds)}秒`;
  if (seconds < 3600) return `${numberFormat.format(seconds / 60)}分`;
  return `${numberFormat.format(seconds / 3600)}時間`;
}

/** @brief 再訪したインストール数と成熟済みの分母を併記する */
function Retention({ title, metric }: { title: string; metric: RetentionMetric }) {
  return <div>
    <dt>{title}</dt>
    <dd>{metric.rate === null ? "集計対象なし" : `${numberFormat.format(metric.rate * 100)}%`}</dd>
    <small>{metric.eligibleDevices === null ? "詳細の保存期間外" : `再訪 ${numberFormat.format(metric.returnedDevices ?? 0)} / 対象 ${numberFormat.format(metric.eligibleDevices)} インストール`}</small>
  </div>;
}

/** @brief 日別値のSVGと同じ情報を読める表を提供する */
function DailyChart({ daily, title, field }: { daily: GameAnalytics["daily"]; title: string; field: "successfulLaunches" | "uniqueDevices" | "durationSeconds" }) {
  const peak = Math.max(1, ...daily.map((day) => day[field] ?? 0));
  const format = field === "durationSeconds" ? duration : (value: number | null) => value === null ? "保存期間外" : numberFormat.format(value);
  const points = daily.map((day, index) => `${40 + (daily.length < 2 ? 225 : index / (daily.length - 1) * 450)},${150 - (day[field] ?? 0) / peak * 125}`).join(" ");
  const unavailable = daily.some((day) => day[field] === null);

  return <figure className="analytics-chart">
    <figcaption>{title}</figcaption>
    {unavailable ? <p>詳細の保存期間外です</p> : daily.length ? <svg viewBox="0 0 510 190" role="img" aria-label={`${title}、最大 ${format(peak)}。日別の値は下の表で確認できます`}>
      <line x1="40" y1="25" x2="490" y2="25" stroke="var(--line)" />
      <line x1="40" y1="150" x2="490" y2="150" stroke="var(--line)" />
      <text x="40" y="17">{format(peak)}</text><text x="20" y="153">0</text>
      <polyline fill="none" stroke="var(--accent-ink)" strokeWidth="2" points={points} />
      {daily.length === 1 && <circle cx="265" cy={150 - (daily[0][field] ?? 0) / peak * 125} r="3" fill="var(--accent-ink)" />}
      <text x="40" y="178">{daily[0].date}</text><text x="490" y="178" textAnchor="end">{daily[daily.length - 1].date}</text>
    </svg> : <p>日別の記録はありません</p>}
    <details><summary>日別の値を表で確認</summary><div className="analytics-table-scroll"><table>
      <thead><tr><th scope="col">日付（日本時間）</th><th scope="col">{title}</th></tr></thead>
      <tbody>{daily.map((day) => <tr key={day.date}><th scope="row">{day.date}</th><td>{format(day[field])}</td></tr>)}</tbody>
    </table></div></details>
  </figure>;
}

/** @brief ゲームごとの集計と実行時間分布を表示する */
function GameStatistics({ game }: { game: GameAnalytics }) {
  const interruptionRate = game.successfulLaunches ? game.counts.interrupted / game.successfulLaunches : null;

  return <article className="analytics-game">
    <header><h2>{game.gameId}</h2><p>バージョン: {game.gameVersion ?? "全バージョン"}</p></header>
    <dl className="analytics-metrics">
      <div><dt>起動成功</dt><dd>{numberFormat.format(game.successfulLaunches)}回</dd><small>起動試行 {numberFormat.format(game.launchAttempts)}回</small></div>
      <div><dt>同意済みインストール</dt><dd>{game.uniqueDevices === null ? "保存期間外" : numberFormat.format(game.uniqueDevices)}</dd><small>期間中に起動成功または実行を観測</small></div>
      <div><dt>期間内の実行時間</dt><dd>{duration(game.totalDurationSeconds)}</dd><small>日付をまたぐ実行を日本時間で分割</small></div>
      <div><dt>1回の平均実行時間</dt><dd>{duration(game.averageDurationSeconds)}</dd><small>中央値 {duration(game.medianDurationSeconds)}</small></div>
      <div><dt>計測中断率</dt><dd>{interruptionRate === null ? "集計対象なし" : `${numberFormat.format(interruptionRate * 100)}%`}</dd><small>中断 {game.counts.interrupted} / 起動成功 {game.successfulLaunches}回</small></div>
      <Retention title="翌日の再訪率" metric={game.retention.nextDay} />
      <Retention title="7日後の再訪率" metric={game.retention.day7} />
    </dl>
    <p className="analytics-explanation">平均・中央値・時間分布は期間中に開始したセッションの観測時間です。計測中のセッションも途中までの時間を含みます。再訪率は直近90日の保存中の詳細で初めて観測した起動成功日（バージョン指定時はそのバージョン）を基準に、翌日・7日後の当日に起動成功または実行時間が記録された割合です。日をまたぐ継続実行も含みます。再訪を確認する日が終わったインストールだけを分母とします。90日より前から利用しているインストールの初回起動日は判別できません。</p>
    {!game.detailAvailable && <p role="status" className="analytics-note">詳細保存期間（直近90日）を過ぎた記録の集計を含むため、インストール数・中央値・再訪率は表示できません</p>}
    <div className="analytics-charts">
      <DailyChart daily={game.daily} title="日別の起動成功回数" field="successfulLaunches" />
      <DailyChart daily={game.daily} title="日別の同意済みインストール数" field="uniqueDevices" />
      <DailyChart daily={game.daily} title="日別の実行時間" field="durationSeconds" />
    </div>
    <div className="analytics-breakdown">
      <section><h3>1回の実行時間の分布</h3><table><thead><tr><th scope="col">時間</th><th scope="col">セッション数</th></tr></thead>
        <tbody>{game.durationHistogram.map((bucket) => <tr key={bucket.label}><th scope="row">{bucket.label}</th><td>{numberFormat.format(bucket.count)}</td></tr>)}</tbody>
      </table></section>
      <section><h3>起動と終了の結果</h3><dl className="analytics-outcomes">
        <div><dt>正常終了</dt><dd>{game.counts.normal}回</dd></div>
        <div><dt>異常終了</dt><dd>{game.counts.abnormal}回</dd></div>
        <div><dt>計測中断</dt><dd>{game.counts.interrupted}回</dd></div>
        <div><dt>起動失敗</dt><dd>{game.counts.launch_failed}回</dd></div>
        <div><dt>計測中</dt><dd>{game.counts.running}回</dd></div>
      </dl><p className="analytics-explanation">計測中の状態が10分を超えて更新されない場合は、中断として一時的に集計します。後から届いた記録で更新されます。</p></section>
    </div>
  </article>;
}

/** @brief 現在の集計結果を式注入を防いだCSVとして保存する */
function downloadCsv(report: AnalyticsReport): void {
  const url = URL.createObjectURL(new Blob([analyticsCsv(report)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `game-analytics-${report.period.environment}-${report.period.from}-${report.period.to}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @brief ゲーム統計を環境・日付・ゲーム・バージョンで絞り込む */
export function AnalyticsDashboard({ initialPeriod }: { initialPeriod: { from: string; to: string } }) {
  const [query, setQuery] = useState(() => new URLSearchParams({ ...initialPeriod, environment: "production" }).toString());
  const [requestNumber, setRequestNumber] = useState(0);
  const [report, setReport] = useState<AnalyticsReport>();
  const [knownGames, setKnownGames] = useState<{ gameId: string; versions: string[] }[]>([]);
  const [gameId, setGameId] = useState("");
  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);

  // 検索更新と画面離脱で古い通信を中止する
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/analytics/games?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (controller.signal.aborted) return;
        setNeedsLogin(response.status === 401);
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "統計を取得できませんでした");
        const result = body as AnalyticsReport;
        setReport(result);
        if (!new URLSearchParams(query).has("gameId")) setKnownGames(result.games.map((game) => ({ gameId: game.gameId, versions: game.versions })));
      })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "統計を取得できませんでした"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, requestNumber]);

  /** @brief 検索入力を検証して新しい集計を取得する */
  function search(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const parameters = new URLSearchParams();
    for (const [key, value] of fields.entries()) if (typeof value === "string" && value) parameters.set(key, value);
    try {
      const nextQuery = analyticsQuery(parameters).toString();
      setError(""); setLoading(true); setReport(undefined);
      setQuery(nextQuery); setRequestNumber((value) => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "検索条件を確認してください"); }
  }

  const successfulLaunches = report?.games.reduce((sum, game) => sum + game.successfulLaunches, 0) ?? 0;
  const totalDuration = report?.games.reduce((sum, game) => sum + game.totalDurationSeconds, 0) ?? 0;
  const versions = knownGames.find((game) => game.gameId === gameId)?.versions ?? [];

  return <main className="analytics-page">
    <header><p className="eyebrow">GAMELAUNCHER / ANALYTICS</p><h1>ゲーム利用統計</h1>
      <p>統計送信に同意したインストールから届いた、起動・実行時間・再訪の集計です</p></header>
    <p className="analytics-note">インストールIDは人数を表しません。再インストール・ID再生成・複数PCでは別件になります。実行時間にはメニューや放置を含み、ランチャーの監視が途切れた後の時間は含みません。ゲームを直接起動した利用は対象外です。</p>
    <form className="analytics-filters" onSubmit={search}>
      <label>公開環境<select name="environment" defaultValue="production"><option value="production">Production（本番）</option><option value="staging">Staging（検証）</option></select></label>
      <label>開始日（日本時間）<input name="from" type="date" required defaultValue={initialPeriod.from} max={initialPeriod.to} /></label>
      <label>終了日（日本時間）<input name="to" type="date" required defaultValue={initialPeriod.to} max={initialPeriod.to} /></label>
      <label>ゲームID<input name="gameId" list="analytics-games" value={gameId} placeholder="すべてのゲーム" onChange={(event) => { setGameId(event.target.value); setVersion(""); }} /></label>
      <datalist id="analytics-games">{knownGames.map((game) => <option key={game.gameId} value={game.gameId} />)}</datalist>
      <label>バージョン<input name="gameVersion" list="analytics-versions" value={version} disabled={!gameId} placeholder="全バージョン" onChange={(event) => setVersion(event.target.value)} /></label>
      <datalist id="analytics-versions">{versions.map((item) => <option key={item} value={item} />)}</datalist>
      <button className="primary-button" type="submit" disabled={loading}>集計を表示</button>
    </form>
    <p className="analytics-explanation">日別集計は最大366日、インストール数・中央値・再訪率の詳細集計は直近90日です</p>
    {error && <p role="alert" className="analytics-error">{error}{needsLogin && <> <a href="/api/auth/github/start">GitHubでログイン</a></>}</p>}
    {loading && <p role="status">集計を読み込んでいます…</p>}
    {report && !loading && <>
      <div className="analytics-summary">
        <div><p>{report.period.from}〜{report.period.to}（日本時間） / {report.period.environment === "production" ? "Production" : "Staging"}</p>
          <p><strong>{numberFormat.format(successfulLaunches)}回</strong>の起動成功 · <strong>{duration(totalDuration)}</strong>の実行時間 · {report.games.length}ゲーム</p>
          <p>最終受信: {report.lastReceivedAt ? <time dateTime={report.lastReceivedAt}>{new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "medium" }).format(new Date(report.lastReceivedAt))}（日本時間）</time> : "受信記録なし"}</p>
        </div><button className="secondary-button" type="button" onClick={() => downloadCsv(report)}>表示中の集計をCSVで保存</button>
      </div>
      {report.games.length ? report.games.map((game) => <GameStatistics key={`${game.gameId}/${game.gameVersion ?? "all"}`} game={game} />) : <p className="empty-state">選択条件の統計はまだ届いていません</p>}
    </>}
  </main>;
}
