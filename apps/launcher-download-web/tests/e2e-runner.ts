import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { startTestServer } from "./server.ts";

const require = createRequire(import.meta.url);
const server = await startTestServer();
try {
  const child = spawn(process.execPath, [require.resolve("@playwright/test/cli"), "test", ...process.argv.slice(2)], { stdio: "inherit" });
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.on("exit", code => resolve(code ?? 1));
    child.on("error", reject);
  });
} finally {
  if ("closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
