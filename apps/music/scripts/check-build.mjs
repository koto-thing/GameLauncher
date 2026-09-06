import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** @brief 公開静的物へ管理コード・認証・外部APIを混ぜない。 @param {string} dir 公開出力。 @returns 検査完了。 */
async function inspect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await inspect(file);
    else if (/\.(js|mjs|html|css)$/.test(file)) {
      const content = await readFile(file, "utf8");
      for (const token of [
        "MUSIC_BRIDGE_SECRET",
        "GITHUB_CLIENT_SECRET",
        "SESSION_SECRET",
        "D1MusicRepository",
        "/api/music",
        "/api/auth/",
        "workers.dev",
        "r2.dev",
        "api.github.com",
        "github.com/login",
        "PandDMusicManager",
        "/__test/",
        "cloudflare:workers",
      ])
        if (content.includes(token))
          throw new Error(`${file}: forbidden public dependency ${token}`);
    }
  }
}
await inspect("dist");
if (
  (await readFile("../../contracts/music/policy.json", "utf8")) !==
  (await readFile("../../server/music/config/policy.json", "utf8"))
)
  throw new Error("PHP policy is out of sync: npm run policy:sync");
console.log("Public bundle and TS/PHP policy boundaries passed.");
