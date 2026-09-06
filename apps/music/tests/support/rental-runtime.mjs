import { build, stop } from "esbuild";
import { Miniflare } from "miniflare";
import { mkdir, readFile, writeFile, mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const workspaceRoot = path.resolve(projectRoot, "../..");

/** @brief 空きローカルポートを取得する。 @returns {Promise<number>} ポート。 */
export async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(
    /** @brief ソケットを返す。 */ (resolve) => server.close(resolve),
  );
  return port;
}
/** @brief 実PHPをdocument root外の私有領域とともに起動する。 @param {object} options ローカル設定。 @returns 配信環境。 */
export async function createPhpServer({
  port,
  directory,
  secret = randomBytes(32).toString("hex"),
} = {}) {
  await mkdir(path.join(projectRoot, "build"), { recursive: true });
  directory ??= await mkdtemp(path.join(projectRoot, "build/rental-"));
  await mkdir(directory, { recursive: true });
  port ??= await freePort();
  const config = {
    environment: "local",
    storageRoot: path.join(directory, "private"),
    documentRoot: path.join(projectRoot, "dist"),
    basePath: "",
    bridgePath: "/bridge.php",
    keys: { primary: secret },
    contactUrl: "",
  };
  const configPath = path.join(directory, "config.php");
  await writeFile(
    path.join(directory, "settings.json"),
    JSON.stringify(config),
  );
  await writeFile(
    configPath,
    "<?php return json_decode(file_get_contents(__DIR__ . '/settings.json'), true);\n",
  );
  const php =
    process.env.PHP_BIN ||
    (process.platform === "win32"
      ? path.join(workspaceRoot, "build/music-tools/php/php.exe")
      : "php");
  const args =
    process.platform === "win32"
      ? [
          "-d",
          `extension_dir=${path.dirname(php)}/ext`,
          "-d",
          "extension=fileinfo",
          "-d",
          "extension=gd",
        ]
      : [];
  const environment = { ...process.env, MUSIC_CONFIG: configPath };
  const init = spawn(
    php,
    [...args, path.join(workspaceRoot, "server/music/scripts/initialize.php")],
    { env: environment, windowsHide: true },
  );
  let initialization = "";
  init.stderr.on(
    "data",
    /** @brief 初期化失敗だけを保存する。 */ (data) => {
      initialization += data;
    },
  );
  if ((await once(init, "exit"))[0] !== 0)
    throw new Error(`PHP initialize: ${initialization}`);
  const child = spawn(
    php,
    [
      ...args,
      "-d",
      "display_errors=0",
      "-d",
      "log_errors=1",
      "-d",
      "memory_limit=256M",
      "-S",
      `127.0.0.1:${port}`,
      "-t",
      config.documentRoot,
      path.join(workspaceRoot, "server/music/tests/router.php"),
    ],
    { env: environment, windowsHide: true },
  );
  let logs = "";
  child.stderr.on(
    "data",
    /** @brief PHPプロセスログを保存する。 */ (data) => {
      logs += data;
    },
  );
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${origin}/api/public/catalogue`)).ok) break;
    } catch {
      /* 起動待ち。 */
    }
    if (attempt === 99) throw new Error(`PHP startup failed: ${logs}`);
    await new Promise(
      /** @brief 起動待ちを短く区切る。 */ (resolve) => setTimeout(resolve, 50),
    );
  }
  return {
    origin,
    secret,
    directory,
    config,
    /** @brief 同じ私有設定で運用CLIを検証する。 @param {string} script scripts内の名前。 @param {string[]} extra 引数。 @returns CLI結果。 */
    async cli(script, extra = []) {
      const command = spawn(
        php,
        [
          ...args,
          path.join(workspaceRoot, "server/music/scripts", script),
          ...extra,
        ],
        { env: environment, windowsHide: true },
      );
      let output = "",
        error = "";
      command.stdout.on(
        "data",
        /** @brief JSON結果を保存する。 */ (data) => {
          output += data;
        },
      );
      command.stderr.on(
        "data",
        /** @brief 検証失敗を保存する。 */ (data) => {
          error += data;
        },
      );
      const code = (await once(command, "exit"))[0];
      if (code !== 0) throw new Error(error || output);
      return JSON.parse(output);
    },
    /** @brief ローカル限定の障害を注入する。 @param {string} fault 障害点。 */
    async fault(fault) {
      await writeFile(
        path.join(directory, "settings.json"),
        JSON.stringify({ ...config, fault }),
      );
    },
    /** @brief 自分のPHPだけを停止する。 */
    async close() {
      child.kill();
      await once(child, "exit");
      await writeFile(path.join(directory, "php.log"), logs);
    },
  };
}
/** @brief 実control-plane入口をworkerdへ載せ、共通D1と実PHPへ接続する。 @param {object} options 隔離設定。 @returns 統合環境。 */
export async function createRuntime({
  port,
  origin = "http://127.0.0.1:8788",
  php,
  enabled = true,
  github,
} = {}) {
  const built = await build({
    entryPoints: [path.join(projectRoot, "tests/support/control-worker.ts")],
    tsconfig: path.join(workspaceRoot, "apps/admin-web/tsconfig.json"),
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    mainFields: ["browser", "module", "main"],
    conditions: ["workerd", "worker", "browser"],
    external: ["node:*", "cloudflare:workers"],
    target: "es2023",
    logLevel: "silent",
  });
  const ownPhp = !php;
  php ??= await createPhpServer();
  const sessionSecret = randomBytes(32).toString("hex");
  const text = /** @brief テキストbindingを明示する。 */ (value) => ({
    type: "text",
    value,
  });
  stop();
  await writeFile(
    path.join(projectRoot, "build/control-test-worker.mjs"),
    built.outputFiles[0].text,
  );
  const runtime = new Miniflare({
    host: "127.0.0.1",
    port,
    workers: [
      {
        config: {
          name: "control-plane-music-test",
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
            DB: { type: "d1", id: "control-plane-local" },
            INTAKE: { type: "r2", name: "game-intake-local" },
            SESSION_SECRET: text(sessionSecret),
            GITHUB_CLIENT_ID: text("local-test-id"),
            GITHUB_CLIENT_SECRET: text("local-test-secret"),
            GITHUB_CALLBACK_URL: text(`${origin}/api/auth/github/callback`),
            LOCAL_DEV_AUTH: text("true"),
            MUSIC_ENABLED: text(String(enabled)),
            MUSIC_ENVIRONMENT: text("local"),
            MUSIC_BRIDGE_URL: text(`${php.origin}/bridge.php`),
            MUSIC_BRIDGE_SECRET: text(php.secret),
            MUSIC_PUBLIC_URL: text(`${php.origin}/`),
            STAGING_DISPATCH_ENABLED: text("false"),
            PRODUCTION_DISPATCH_ENABLED: text("false"),
          },
        },
        ...(github
          ? { dev: { outboundService: { type: "fetcher", handler: github } } }
          : {}),
      },
    ],
  });
  await runtime.ready;
  if (process.env.MUSIC_TEST_DEBUG) console.log("workerd ready");
  if (process.env.MUSIC_TEST_DEBUG)
    console.log(
      "Worker response",
      (await runtime.dispatchFetch(`${origin}/api/intake/config`)).status,
    );
  const db = testDatabase(runtime, origin);
  if (process.env.MUSIC_TEST_DEBUG) console.log("D1 binding ready");
  const sql = (
    await readFile(
      path.join(workspaceRoot, "apps/admin-web/drizzle/0004_music.sql"),
      "utf8",
    )
  )
    .split("\n")
    .filter(
      /** @brief SQLコメントだけを除く。 */ (line) =>
        !line.trim().startsWith("--"),
    )
    .join("\n");
  if (process.env.MUSIC_TEST_DEBUG) console.log("D1 SQL bytes", sql.length);
  await db.exec(sql);
  if (process.env.MUSIC_TEST_DEBUG) console.log("D1 schema ready");
  for (const [id, login, admin] of [
    ["900001", "music-admin", 1],
    ["900002", "music-a", 0],
    ["900003", "music-b", 0],
  ])
    await db
      .prepare("INSERT INTO music_accounts VALUES(?,?,?)")
      .bind(id, login, admin)
      .run();
  return {
    runtime,
    db,
    php,
    origin,
    sessionSecret,
    /** @brief 実Worker APIへ配送する。 @param {...unknown} args Fetch引数。 */
    dispatchFetch(...args) {
      return runtime.dispatchFetch(...args);
    },
    /** @brief この試験で所有する実行環境だけを停止する。 */
    async dispose() {
      await runtime.dispose();
      if (ownPhp) await php.close();
    },
  };
}

/** @brief テスト用SQLをWorker内の実D1 bindingで実行する。 @param {Miniflare} runtime 実行環境。 @param {string} origin 管理origin。 @returns fixture操作。 */
function testDatabase(runtime, origin) {
  /** @brief テスト専用入口で実D1 batchを実行する。 @param {object[]} queries SQL列。 */
  async function execute(queries) {
    const response = await runtime.dispatchFetch(`${origin}/__test/db`, {
      method: "POST",
      body: JSON.stringify({ queries }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }
  return {
    /** @brief 1行に1文のmigrationを実D1へ適用する。 @param {string} sql migration。 */
    async exec(sql) {
      return execute(
        sql
          .split("\n")
          .map(/** @brief 空白を除く。 */ (line) => line.trim())
          .filter(Boolean)
          .map(
            /** @brief statementに変換する。 */ (sql) => ({ sql, values: [] }),
          ),
      );
    },
    /** @brief パラメーターSQLのテスト用ハンドルを作る。 @param {string} sql SQL。 */
    prepare(sql) {
      let values = [];
      const statement = {
        /** @brief パラメーターを保持する。 @param {...unknown} args 値。 */
        bind(...args) {
          values = args;
          return statement;
        },
        /** @brief 更新を実行する。 */
        async run() {
          return (await execute([{ sql, values }]))[0];
        },
        /** @brief 読取結果を返す。 */
        async all() {
          return statement.run();
        },
        /** @brief 最初の行を返す。 */
        async first() {
          return (await statement.run()).results[0] ?? null;
        },
      };
      return statement;
    },
  };
}
/** @brief 既存control-planeの共通CookieでAPIを操作する。 @param {object} runtime 環境。 @param {string|null} account 本人。 @returns HTTPクライアント。 */
export async function fixtureClient(runtime, account = "music-admin") {
  const origin = runtime.origin;
  let cookie = "";
  if (account) {
    const login = await runtime.dispatchFetch(
      `${origin}/api/auth/dev?as=${account}`,
      { redirect: "manual" },
    );
    cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  }
  /** @brief raw本文とJSONを分離して実入口へ送る。 @param {string} route API。 @param {object} options HTTP入力。 */
  async function request(
    route,
    { method = "GET", body, bytes, headers = {} } = {},
  ) {
    return runtime.dispatchFetch(
      `${origin}${route.startsWith("/api/") ? route : `/api/music${route}`}`,
      {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
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
      },
    );
  }
  /** @brief 成功以外のHTTP応答で試験を失敗させる。 @param {string} route API。 @param {object} options 入力。 */
  async function json(route, options = {}) {
    const response = await request(route, options);
    const value = await response.json();
    if (!response.ok)
      throw new Error(`${response.status}: ${JSON.stringify(value)}`);
    return value;
  }
  /** @brief 本番と同じ2段階ストリーム投稿を実行する。 @param {string} gameId 作品。 @param {string} kind 用途。 @param {Buffer} bytes 原本。 @param {string} mime 形式。 */
  async function upload(
    gameId,
    kind,
    bytes,
    mime = kind === "audio" ? "audio/wav" : "image/png",
  ) {
    const start = await json("/uploads", {
      method: "POST",
      body: {
        gameId,
        kind,
        bytes: bytes.length,
        mime,
        digest: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    return json(`/uploads/${start.id}`, { method: "PUT", bytes });
  }
  return { request, json, upload, cookie, csrf: "same-origin" };
}
