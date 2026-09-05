import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
/** @brief 実Workerコードをworkerd用にbundleし実D1/R2ローカルエミュレーターへ接続する。 */
export async function createRuntime({
  persistent = false,
  port,
  origin = "http://127.0.0.1:5173",
  production = false,
} = {}) {
  await mkdir(path.join(projectRoot, "build"), { recursive: true });
  const built = await build({
    entryPoints: [
      path.join(
        projectRoot,
        production
          ? "src/composition/server.ts"
          : "tests/support/local-worker.ts",
      ),
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    mainFields: ["browser", "module", "main"],
    target: "es2023",
    conditions: ["workerd", "worker", "browser"],
    external: ["node:*"],
    logLevel: "silent",
  });
  const runtime = new Miniflare({
    host: "127.0.0.1",
    port,
    ...(persistent
      ? { resourcePersistencePath: path.join(projectRoot, ".wrangler/local") }
      : {}),
    workers: [
      {
        config: {
          name: "music-local",
          type: "worker",
          compatibilityDate: "2026-09-02",
          compatibilityFlags: ["nodejs_compat"],
          manifest: {
            mainModule: "worker.mjs",
            modules: {
              "worker.mjs": {
                type: "esm",
                contents: built.outputFiles[0].text,
              },
            },
          },
          env: {
            MUSIC_DB: { type: "d1", id: "music-local" },
            MUSIC_ASSETS: { type: "r2", name: "music-local" },
            SITE_ORIGIN: { type: "text", value: origin },
            ENVIRONMENT: { type: "text", value: "local" },
            CONTACT_URL: { type: "text", value: "" },
          },
        },
      },
    ],
  });
  await runtime.ready;
  const db = await runtime.getD1Database("MUSIC_DB");
  const exists = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='games'",
    )
    .first();
  if (!exists) {
    // D1 execの1行制限に合わせ、SQLコメントを除去してトリガーを同じ文のまま保持する。
    const sql = (
      await readFile(
        path.join(projectRoot, "migrations/0001_music.sql"),
        "utf8",
      )
    )
      .split("\n")
      .filter(
        /** @brief スキーマ内の説明コメントだけを除く。 */ (line) =>
          !line.trim().startsWith("--"),
      )
      .join("\n");
    await db.exec(sql);
  }
  if (!production)
    for (const [id, login, admin] of [
      ["900001", "admin", 1],
      ["900002", "composer-a", 0],
      ["900003", "composer-b", 0],
      ["900004", "outsider", 0],
    ])
      await db
        .prepare("INSERT INTO accounts VALUES(?,?,?) ON CONFLICT DO NOTHING")
        .bind(id, login, admin)
        .run();
  return runtime;
}
/** @brief 実セッションCookieを取得するテスト用クライアントを作る。 @param {import('miniflare').Miniflare} runtime 実行環境。 @param {string | null} account 固定アカウントまたは匿名。 @param {string} origin 正規Origin。 */
export async function fixtureClient(
  runtime,
  account = "admin",
  origin = "http://127.0.0.1:5173",
) {
  let cookie = "";
  let csrf = "";
  if (account) {
    const login = await runtime.dispatchFetch(`${origin}/api/local/login`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ account }),
    });
    cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const me = await runtime.dispatchFetch(`${origin}/api/auth/me`, {
      headers: { Cookie: cookie },
    });
    csrf = (await me.json())?.csrf ?? "";
  }
  /** @brief 認証情報以外は本番と同じHTTP経路でAPIを呼ぶ。 @param {string} route APIパス。 @param {{method?: string, body?: unknown, bytes?: Uint8Array, headers?: Record<string,string>}} options リクエスト。 */
  async function request(
    route,
    { method = "GET", body, bytes, headers = {} } = {},
  ) {
    return runtime.dispatchFetch(`${origin}/api${route}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
        Origin: origin,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(bytes
          ? {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(bytes.length),
            }
          : {}),
        ...headers,
      },
      body: bytes ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  }
  /** @brief 成功レスポンス以外は本文を含めてテストを失敗させる。 @template [T=unknown] @param {string} route APIパス。 @param {Parameters<typeof request>[1]} [options] 入力。 @returns {Promise<T>} JSON。 */
  async function json(route, options) {
    const response = await request(route, options);
    const value = await response.json();
    if (!response.ok)
      throw new Error(`${response.status}: ${JSON.stringify(value)}`);
    return /** @type {T} */ (value);
  }
  return { request, json, cookie, csrf };
}
