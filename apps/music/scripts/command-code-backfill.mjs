import { readFile, writeFile } from "node:fs/promises";

// 実行先は利用者が明示するデフォルトは対象確認だけで、コードを予約しない
const args = process.argv.slice(2);
/** @brief 指定された単一CLI引数を読む秘密値は引数にしない */
function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
const origin = new URL(option("--origin") ?? "http://127.0.0.1:8788").origin;
if (
  !origin.startsWith("https:") &&
  !/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin)
)
  throw new Error("HTTPSまたはローカル開発originを指定してください。");
const cookie = process.env.MUSIC_ADMIN_COOKIE;
if (!cookie)
  throw new Error(
    "Music管理のCookieをMUSIC_ADMIN_COOKIE環境変数へ設定してください。値をログや計画ファイルへ保存しないでください。",
  );
/** @brief 管理APIだけを認可済みCookieで呼び、redirect先へ秘密を送らない */
async function api(route, body) {
  const response = await fetch(`${origin}/api/music${route}`, {
    method: body ? "POST" : "GET",
    redirect: "error",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response.json();
}
const apply = option("--apply"),
  output = option("--output") ?? "command-code-plan.json";
if (apply) {
  const plan = JSON.parse(await readFile(apply, "utf8"));
  if (plan.origin !== origin)
    throw new Error("確認済み計画と実行先が違います。");
  for (const game of plan.games) {
    const current = await api(
      `/manage/games/${encodeURIComponent(game.gameId)}/command-codes`,
      { dryRun: true },
    );
    if (
      current.skipped ||
      JSON.stringify(current.targets) !== JSON.stringify(game.targets)
    )
      throw new Error(
        `対象が変わりました: ${game.gameId}。dry-runをやり直してください。`,
      );
    await api(
      `/manage/games/${encodeURIComponent(game.gameId)}/command-codes`,
      { dryRun: false },
    );
    console.log(`公開コード反映済み: ${game.gameId}`);
  }
} else {
  const games = [];
  for (const game of await api("/manage/games")) {
    if (option("--game") && option("--game") !== game.id) continue;
    const result = await api(
      `/manage/games/${encodeURIComponent(game.id)}/command-codes`,
      { dryRun: true },
    );
    if (!result.skipped) games.push({ gameId: game.id, ...result });
  }
  await writeFile(output, JSON.stringify({ origin, games }, null, 2));
  console.log(
    `DRY RUN: ${games.length}作品。対象一覧: ${output}。コード発行・公開更新はしていません。`,
  );
}
