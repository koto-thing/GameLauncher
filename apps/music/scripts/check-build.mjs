import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** @brief 公開bundleの文字列を検査する。 */
async function inspect(dir, server = false) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await inspect(file, server);
    else if (/\.(js|mjs|html)$/.test(file)) {
      const content = await readFile(file, "utf8");
      const prohibited = server
        ? ["/api/local/login", "Unknown fixture", "900001"]
        : [
            "GITHUB_CLIENT_SECRET",
            "BOOTSTRAP_ADMIN_IDS",
            "D1MusicRepository",
            "github.com/login/oauth/access_token",
          ];
      for (const token of prohibited)
        if (content.includes(token))
          throw new Error(`${file}: forbidden production token ${token}`);
    }
  }
}
await inspect("dist/client");
// Worker出力のディレクトリ名はCloudflare Vite pluginのnameに従う。
for (const entry of await readdir("dist", { withFileTypes: true }))
  if (entry.isDirectory() && entry.name !== "client")
    await inspect(path.join("dist", entry.name), true);
console.log("Production bundle boundaries passed.");
