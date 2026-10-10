import type { AnalyticsReport, AnalyticsGame as GameAnalytics, RetentionMetric } from "../../../services/platform-api/src/types";

export type { AnalyticsReport, AnalyticsGame as GameAnalytics, RetentionMetric, PlayEnvironment as AnalyticsEnvironment } from "../../../services/platform-api/src/types";

export type AnalyticsActor = { isAdmin: boolean; gameAccess: boolean };

export type AnalyticsBinding = { fetch(request: Request): Promise<Response> };

const DAY_MILLISECONDS = 86400000;
const RESPONSE_HEADERS = { "cache-control": "no-store, max-age=0" };

/** @brief 統計の表示項目に制御文字が含まれないことを確認する */
function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

/** @brief 日本時間の直近30日を初期検索期間にする */
export function defaultAnalyticsPeriod(now: number = Date.now()): { from: string; to: string } {
  const jst = now + 9 * 3600000;
  return { from: new Date(jst - 29 * DAY_MILLISECONDS).toISOString().slice(0, 10), to: new Date(jst).toISOString().slice(0, 10) };
}

/** @brief 統計閲覧をゲーム管理許可のある運営管理者だけに制限する */
export function requireAnalyticsAdmin(actor: AnalyticsActor | null): void {
  if (!actor) throw new Response("Authentication required", { status: 401 });
  if (actor.gameAccess !== true || actor.isAdmin !== true) throw new Response("Administrator permission required", { status: 403 });
}

/** @brief 実在する日付だけを統計検索へ渡す */
function analyticsDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error("日付をYYYY-MM-DD形式で指定してください");
  }
  return value;
}

/** @brief 統計検索条件を検証しAPIへ送るパラメーターに限定する */
export function analyticsQuery(input: URLSearchParams, now: number = Date.now()): URLSearchParams {
  const allowed = new Set(["from", "to", "environment", "gameId", "gameVersion"]);
  for (const key of input.keys()) {
    if (!allowed.has(key) || input.getAll(key).length !== 1) throw new Error("統計検索条件が正しくありません");
  }

  const defaults = defaultAnalyticsPeriod(now);
  const from = analyticsDate(input.get("from") ?? defaults.from);
  const to = analyticsDate(input.get("to") ?? defaults.to);
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MILLISECONDS + 1;
  if (days < 1 || days > 366 || to > defaults.to) throw new Error("期間は日本時間の今日までの1〜366日で指定してください");
  const environment = input.get("environment") ?? "production";
  if (environment !== "production" && environment !== "staging") throw new Error("公開環境を選択してください");

  const query = new URLSearchParams({ from, to, environment });
  const gameId = input.get("gameId");
  if (gameId) {
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(gameId)) throw new Error("ゲームIDが正しくありません");
    query.set("gameId", gameId);
  }
  const version = input.get("gameVersion");
  if (version) {
    if (!gameId || !/^[A-Za-z0-9.+_-]{1,64}$/.test(version)) throw new Error("バージョンとゲームを選択してください");
    query.set("gameVersion", version);
  }
  return query;
}

/** @brief 上流の値をオブジェクトとして検証する */
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid analytics response");
  return value as Record<string, unknown>;
}

/** @brief 上流の計測値を有限の非負数として検証する */
function metric(value: unknown, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw new Error("Invalid analytics metric");
  return value;
}

/** @brief 詳細保存期限を過ぎた計測値をnullのまま扱う */
function nullableMetric(value: unknown, integer = false): number | null {
  return value === null ? null : metric(value, integer);
}

/** @brief 上流の表示文字列から制御文字と過剰なサイズを除外する */
function label(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 100 || hasControlCharacters(value)) throw new Error("Invalid analytics label");
  return value;
}

/** @brief 配列応答が指定サイズ以内であることを確認する */
function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error("Invalid analytics list");
  return value;
}

/** @brief 再訪率は分母を保持し、未観測と0件を区別する */
function retention(value: unknown): RetentionMetric {
  const item = object(value);
  const eligibleDevices = nullableMetric(item.eligibleDevices, true);
  const returnedDevices = nullableMetric(item.returnedDevices, true);
  const rate = nullableMetric(item.rate);
  if ((eligibleDevices === null) !== (returnedDevices === null) || (eligibleDevices !== null && returnedDevices !== null && returnedDevices > eligibleDevices) || (rate !== null && rate > 1)) throw new Error("Invalid retention");
  return { eligibleDevices, returnedDevices, rate: eligibleDevices ? (returnedDevices as number) / eligibleDevices : null };
}

/** @brief ブラウザへ返せる集計項目だけを再構成し識別子や未知の上流項目を除く */
export function parseAnalyticsReport(value: unknown): AnalyticsReport {
  const report = object(value);
  const period = object(report.period);
  if (report.schemaVersion !== 1 || period.timeZone !== "Asia/Tokyo" || (period.environment !== "production" && period.environment !== "staging")) throw new Error("Invalid analytics report");
  if (report.lastReceivedAt !== null && (typeof report.lastReceivedAt !== "string" || !Number.isFinite(Date.parse(report.lastReceivedAt)))) throw new Error("Invalid receipt timestamp");

  return {
    schemaVersion: 1,
    period: { from: analyticsDate(period.from), to: analyticsDate(period.to), timeZone: "Asia/Tokyo", environment: period.environment },
    lastReceivedAt: report.lastReceivedAt as string | null,
    games: list(report.games, 1000).map((value): GameAnalytics => {
      const game = object(value);
      const counts = object(game.counts);
      const revisits = object(game.retention);
      const gameId = label(game.gameId);
      if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(gameId) || typeof game.detailAvailable !== "boolean") throw new Error("Invalid game analytics");

      return {
        gameId, gameVersion: game.gameVersion === null ? null : label(game.gameVersion),
        versions: list(game.versions, 1000).map(label),
        launchAttempts: metric(game.launchAttempts, true), successfulLaunches: metric(game.successfulLaunches, true),
        uniqueDevices: nullableMetric(game.uniqueDevices, true), totalDurationSeconds: metric(game.totalDurationSeconds),
        averageDurationSeconds: metric(game.averageDurationSeconds), medianDurationSeconds: nullableMetric(game.medianDurationSeconds),
        counts: { running: metric(counts.running, true), normal: metric(counts.normal, true), abnormal: metric(counts.abnormal, true), interrupted: metric(counts.interrupted, true), launch_failed: metric(counts.launch_failed, true) },
        durationHistogram: list(game.durationHistogram, 30).map((value) => {
          const bucket = object(value);
          return { label: label(bucket.label), minSeconds: metric(bucket.minSeconds), maxSeconds: nullableMetric(bucket.maxSeconds), count: metric(bucket.count, true) };
        }),
        daily: list(game.daily, 366).map((value) => {
          const day = object(value);
          return { date: analyticsDate(day.date), launchAttempts: metric(day.launchAttempts, true), successfulLaunches: metric(day.successfulLaunches, true), uniqueDevices: nullableMetric(day.uniqueDevices, true), durationSeconds: metric(day.durationSeconds) };
        }),
        retention: { nextDay: retention(revisits.nextDay), day7: retention(revisits.day7) },
        detailAvailable: game.detailAvailable,
      };
    }),
  };
}

/** @brief 認証を確認してService Binding経由で集計を読み、秘密や上流エラーを公開しない */
export async function analyticsResponse(request: Request, actor: AnalyticsActor | null, binding?: AnalyticsBinding, token?: string): Promise<Response> {
  try {
    requireAnalyticsAdmin(actor);
    const query = analyticsQuery(new URL(request.url).searchParams);
    if (!binding || !token?.trim()) return Response.json({ error: "統計サービスが未設定です。運営側の接続設定後に利用できます" }, { status: 503, headers: RESPONSE_HEADERS });

    try {
      const upstream = await binding.fetch(new Request(`https://platform.internal/v1/analytics/games?${query}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(15000),
      }));
      if (!upstream.ok) throw new Error("Analytics upstream unavailable");
      const report = parseAnalyticsReport(await upstream.json());
      if (report.period.from !== query.get("from") || report.period.to !== query.get("to") || report.period.environment !== query.get("environment")) throw new Error("Analytics period mismatch");
      return Response.json(report, { headers: RESPONSE_HEADERS });
    } catch {
      return Response.json({ error: "統計サービスから集計を取得できませんでした。時間をおいて再試行してください" }, { status: 502, headers: RESPONSE_HEADERS });
    }
  } catch (error) {
    const status = error instanceof Response ? error.status : 400;
    const message = error instanceof Response ? (status === 401 ? "GitHubでログインしてください" : "統計の閲覧には運営管理者の権限が必要です") : error instanceof Error ? error.message : "検索条件を確認してください";
    return Response.json({ error: message }, { status, headers: RESPONSE_HEADERS });
  }
}

/** @brief CSVの文字列セルを式として実行されない形で引用する */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  const safe = typeof value === "string" && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** @brief 識別子を含まないゲーム別と日別集計をCSVへ出力する */
export function analyticsCsv(report: AnalyticsReport): string {
  const rows: (string | number | null)[][] = [["environment", "from_jst", "to_jst", "game_id", "game_version", "date_jst", "launch_attempts", "successful_launches", "opt_in_installations", "duration_seconds", "average_duration_seconds", "median_duration_seconds", "tracking_interrupted", "tracking_interruption_denominator", "d1_returned_installations", "d1_eligible_installations", "d7_returned_installations", "d7_eligible_installations"]];
  for (const game of report.games) {
    const prefix = [report.period.environment, report.period.from, report.period.to, game.gameId, game.gameVersion];
    rows.push([...prefix, "", game.launchAttempts, game.successfulLaunches, game.uniqueDevices, game.totalDurationSeconds, game.averageDurationSeconds, game.medianDurationSeconds, game.counts.interrupted, game.successfulLaunches, game.retention.nextDay.returnedDevices, game.retention.nextDay.eligibleDevices, game.retention.day7.returnedDevices, game.retention.day7.eligibleDevices]);
    for (const day of game.daily) rows.push([...prefix, day.date, day.launchAttempts, day.successfulLaunches, day.uniqueDevices, day.durationSeconds, null, null, null, null, null, null, null, null]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
