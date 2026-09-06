import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  createPhpServer,
  projectRoot,
  workspaceRoot,
} from "../tests/support/rental-runtime.mjs";
import { seed } from "./seed.mjs";

const adminRoot = path.join(workspaceRoot, "apps/admin-web");
process.env.WRANGLER_LOG_PATH = path.join(
  workspaceRoot,
  "build/music-wrangler.log",
);
process.env.WRANGLER_SEND_METRICS = "false";
/** @brief CLIを引数配列でローカルだけに実行する。 @param {string[]} args Node CLI引数。 @param {string} cwd 作業場所。 @returns {Promise<void>} 正常終了。 */
async function run(args, cwd) {
  const child = spawn(process.execPath, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });
  if ((await once(child, "exit"))[0] !== 0)
    throw new Error(`Local command failed: ${args[0]}`);
}
// 公開静的物とcontrol-plane管理entryを先にbuildする。
await run(["node_modules/vite/bin/vite.js", "build"], projectRoot);
await run(
  [
    "node_modules/vite/bin/vite.js",
    "build",
    "--config",
    "vite.manager.config.ts",
  ],
  projectRoot,
);
await mkdir(path.join(adminRoot, "build"), { recursive: true });
const local =
  process.env.MUSIC_E2E === "true"
    ? await mkdtemp(path.join(adminRoot, "build/music-e2e-"))
    : path.join(adminRoot, "build/music-local");
await mkdir(local, { recursive: true });
process.env.MUSIC_LOCAL_DIRECTORY = local;
const php = await createPhpServer({
  port: 8088,
  directory:
    process.env.MUSIC_E2E === "true"
      ? path.join(local, "rental")
      : path.join(projectRoot, "build/local-rental"),
});
const config = {
  name: "pandd-control-plane-music-local",
  compatibility_date: "2026-09-02",
  compatibility_flags: ["nodejs_compat"],
  main: path.join(
    adminRoot,
    "node_modules/vinext/dist/server/fetch-handler.js",
  ),
  vars: {
    LOCAL_DEV_AUTH: "true",
    SESSION_SECRET: randomBytes(32).toString("hex"),
    MUSIC_ENABLED: "true",
    MUSIC_ENVIRONMENT: "local",
    MUSIC_BRIDGE_URL: `${php.origin}/bridge.php`,
    MUSIC_PUBLIC_URL: `${php.origin}/`,
    MUSIC_BRIDGE_SECRET: php.secret,
    STAGING_DISPATCH_ENABLED: "false",
    PRODUCTION_DISPATCH_ENABLED: "false",
  },
  d1_databases: [
    {
      binding: "DB",
      database_name: "music-control-plane-local",
      database_id: "00000000-0000-4000-8000-000000000001",
      migrations_dir: path.join(adminRoot, "drizzle"),
    },
  ],
  r2_buckets: [{ binding: "INTAKE", bucket_name: "music-test-game-intake" }],
};
await writeFile(path.join(local, "wrangler.json"), JSON.stringify(config));
const cli = ["node_modules/wrangler/bin/wrangler.js", "d1"];
const common = [
  "DB",
  "--local",
  "--config",
  path.join(local, "wrangler.json"),
  "--persist-to",
  path.join(local, "state"),
];
let child;
/** @brief 子プロセス終了へ制御を戻し、PHPもfinallyで停止する。 */
function stop() {
  child?.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on(
  "message",
  /** @brief E2E親プロセスから安全に終了する。 */ (message) => {
    if (message === "stop") stop();
  },
);
try {
  await run([...cli, "migrations", "apply", ...common], adminRoot);
  const fixture =
    "INSERT INTO music_accounts(id,login,admin) VALUES('900001','music-admin',1),('900002','music-a',0),('900003','music-b',0) ON CONFLICT(id) DO NOTHING;";
  await writeFile(path.join(local, "seed.sql"), fixture);
  await run(
    [...cli, "execute", ...common, "--file", path.join(local, "seed.sql")],
    adminRoot,
  );
  child = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--config", "vite.music-local.config.ts"],
    { cwd: adminRoot, stdio: "inherit", windowsHide: true },
  );
  const origin = "http://127.0.0.1:8788";
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (
        (
          await fetch(`${origin}/api/intake/config`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      )
        break;
    } catch {
      /* 実vinextサーバー起動待ち。 */
    }
    if (attempt === 99) throw new Error("control-plane startup failed");
    await new Promise(
      /** @brief 起動待ちを短く区切る。 */ (resolve) =>
        setTimeout(resolve, 200),
    );
  }
  // 本番と同じHTTP APIへseedし、DB直接書込で公開済みを偽装しない。
  await seed({
    origin,
    dispatchFetch: /** @brief 実vinext経由でHTTPを呼ぶ。 */ (...args) =>
      fetch(...args),
  });
  console.log(
    `Music管理: ${origin}/music\n公開サイト: ${php.origin}\n停止: Ctrl+C（ローカルデータは保持）`,
  );
  process.send?.("ready");
  await once(child, "exit");
} finally {
  child?.kill();
  await php.close();
  process.disconnect?.();
}
