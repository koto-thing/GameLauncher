import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { startLocal } from "./local.mjs";

const require = createRequire(import.meta.url);
// ブラウザー実体とレポートはワークスペース内に閉じ込める。
const local = process.argv[2] === "test" ? await startLocal(true) : null;
try {
  const child = spawn(
    process.execPath,
    [require.resolve("@playwright/test/cli"), ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: path.resolve("build/browsers"),
      },
    },
  );
  process.exitCode = await new Promise(
    /** @brief テストの終了コードを保持する。 */ (resolve) =>
      child.on(
        "exit",
        /** @brief インストール・テスト完了を待機元へ通知する。 */ (code) =>
          resolve(code ?? 1),
      ),
  );
} finally {
  await local?.close();
}
