import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { createRuntime, projectRoot } from "../tests/support/runtime.mjs";
import { seed } from "./seed.mjs";
import { pathToFileURL } from "node:url";

// テスト認証のあるWorkerは127.0.0.1でだけ起動する。本番buildからは到達不能。
/** @brief 呼び出し元が寿命を管理できるローカルサーバーを起動する。 */
export async function startLocal(e2e = false) {
  const port = e2e ? 5174 : 5173;
  const apiPort = e2e ? 8790 : 8789;
  const runtime = await createRuntime({
    persistent: !e2e,
    port: apiPort,
    origin: `http://127.0.0.1:${port}`,
  });
  if (e2e) await seed(runtime, `http://127.0.0.1:${port}`);
  const server = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${apiPort}` },
    },
  });
  await server.listen();
  server.printUrls();
  /** @brief 子プロセスの強制終了に依存せずDB・サーバーを明示的に閉じる。 */
  async function close() {
    await server.close();
    await runtime.dispose();
  }
  return { close };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const local = await startLocal();
  console.log(
    "LOCAL DEMO ONLY: 固定fixture認証 / D1・R2はローカル永続化。seed: npm run seed（停止中に実行）",
  );
  /** @brief 対話サーバー終了時に保存を完了してから終了する。 */
  async function shutdown() {
    await local.close();
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
