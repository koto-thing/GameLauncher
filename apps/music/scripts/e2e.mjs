import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
let server;
try {
  if (process.argv[2] === "test") {
    await import("./build-harness.mjs");
    if (process.env.MUSIC_E2E_EXTERNAL !== "true") {
      server = fork("scripts/local-control.mjs", [], {
        env: { ...process.env, MUSIC_E2E: "true" },
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        windowsHide: true,
      });
      await Promise.race([
        once(server, "message"),
        once(server, "exit").then(
          /** @brief 起動失敗をテスト開始前に検出する。 */ () => {
            throw new Error("Local Music server failed to start");
          },
        ),
      ]);
    }
  }
  const child = spawn(
    process.execPath,
    [require.resolve("@playwright/test/cli"), ...process.argv.slice(2)],
    {
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: path.resolve("build/browsers"),
      },
    },
  );
  process.exitCode = (await once(child, "exit"))[0] ?? 1;
} finally {
  if (server?.connected) {
    server.send("stop");
    await once(server, "exit");
  }
}
