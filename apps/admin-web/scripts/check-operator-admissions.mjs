import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const names = ["koto-thing","momiji1107","RyotaIzumi","botamochi1111","isshi-1092","OHAYOGOMI","Aya-8","seikasan","Land-Eater","kabayaki944"].map(name=>name.toLowerCase());

/** @brief 読み取り専用の棚卸しを検証し、既存運営の追加・削除・権限推測をしない */
export async function checkInventory(rows, lookup) {
  if (!Array.isArray(rows) || rows.length !== 10 || new Set(rows.map(row=>row.github_user_id)).size !== 10) throw new Error("Expected exactly ten distinct existing operators; stop and review");
  const found = new Set();
  for (const row of rows) {
    if (!names.includes(row.login_snapshot?.toLowerCase()) || !["admin","executive","assistant"].includes(row.role)) throw new Error("Unexpected name or role; stop and review");
    const actual = await lookup(row.login_snapshot);
    if (String(actual.id) !== row.github_user_id || actual.login.toLowerCase() !== row.login_snapshot.toLowerCase()) throw new Error(`GitHub identity changed: ${row.login_snapshot}; explicit reapproval required before rollout`);
    found.add(row.login_snapshot.toLowerCase());
  }
  if (found.size !== 10 || !rows.some(row=>row.github_user_id === "130458173" && row.role === "admin") || !rows.some(row=>row.github_user_id === "178362923" && row.role === "admin")) throw new Error("Both known Admins must remain active; stop and review");
}

// 入力はD1の読み取り結果。接続するのはGitHubの公開本人情報だけでDBへは書き込まない
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(await readFile(process.argv[2],"utf8"));
  const rows = input[0]?.results ? input.flatMap(result=>result.results) : input;
  await checkInventory(rows, async login => {
    const response = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers: {accept:"application/vnd.github+json","user-agent":"PandD-admission-preflight"},
      redirect:"manual", signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`GitHub verification failed (${response.status}); do not deploy`);
    return response.json();
  });
  console.log("Verified ten existing operators and both known Admins. No permissions or data were changed.");
}
