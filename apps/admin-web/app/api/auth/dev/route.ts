import {
  createSessionCookie,
  ensureLocalFixtures,
  localDevAuthAvailable,
  localUsers,
  musicLocalUsers,
  upsertUser,
} from "@/lib/auth";

/**
 * ローカル開発環境専用の GET エンドポイント
 * @param request リクエストヘッダー
 * @constructor
 */
export async function GET(request: Request) {
  // セキュリティチェック
  if (!localDevAuthAvailable(request)) return new Response("Not found", { status: 404 });

  // クエリ文字列を取得、未指定時はadmin
  const selected = new URL(request.url).searchParams.get("as") ?? "admin";
  // 定義済みのモックユーザー一覧から対象ユーザーのテンプレを検索
  const template = localUsers[selected] ?? musicLocalUsers[selected];
  // ユーザーが存在しない場合は HTTP 400を返す
  if (!template) return new Response("Unknown local user", { status: 400 });

  // ローカルデータの初期化
  await ensureLocalFixtures();

  // ユーザー情報の準備
  const user = { ...template, authenticatedAt: new Date().toISOString() };
  // セッション発行とリダイレクトを行う
  if (user.gameAccess) await upsertUser(user);
  return new Response(null, {
    status: 302,
    headers: {
      location: user.gameAccess ? "/" : "/music",
      "set-cookie": await createSessionCookie(user, request),
    },
  });
}
