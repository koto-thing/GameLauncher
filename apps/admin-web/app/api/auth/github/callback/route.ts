import {
  githubFlowVerifier,
  githubCallback,
  clearStateCookie,
  createSessionCookie,
  githubClientConfig,
  type SessionUser,
  verifyGithubIdentity,
} from "@/lib/auth";

/**
 * GitHub OAuth 認証のコールバック用 GET エンドポイント
 * @param request
 * @constructor
 */
export async function GET(request: Request) {
  const url = new URL(request.url);                                                   // リクエスト URL
  const code = url.searchParams.get("code");                          // 認可コード
  const state = url.searchParams.get("state");                        // 認可状態

  // 保存されていた情報と認可状態をチェックして、PKCE用のコード検証子を取り出す
  const verifier = state ? await githubFlowVerifier(request, state) : null;
  // code がない、認可状態不正 or 一致しないときは、Cookie を削除して HTTP 400を返す
  if (!code || !verifier) {
    return Response.json(
      { error: "GitHub OAuth stateが一致しません" },
      { status: 400, headers: { "set-cookie": clearStateCookie(request) } },
    );
  }

  try {
    /* アクセストークンを交換 */
    const { clientId, clientSecret } = githubClientConfig();
    const redirectUri = githubCallback(request);
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    });


    const tokenPayload = await tokenResponse.json() as { access_token?: string; error?: string };
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      throw new Error(tokenPayload.error ?? "GitHub token exchange failed");
    }

    // 取得したアクセストークンを使って、GitHub API を通じてログインしたユーザー情報を取得し、検証
    const actor: SessionUser = await verifyGithubIdentity(tokenPayload.access_token);
    // 権限に応じて遷移先を切り替える
    const headers = new Headers({ location: actor.gameAccess ? "/" : "/music" });

    // set-cookie でログインセッションCookieを発行
    headers.append("set-cookie", await createSessionCookie(actor, request));
    // set-cookie で認証フロー中に使っていた一時的な state Cookie を削除
    headers.append("set-cookie", clearStateCookie(request));

    // HTTP 302 を返す
    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (error) {
    // GitHub との通信などに失敗した場合、Cookieを削除して HTTP 502を返す
    const message = error instanceof Error ? error.message : "GitHubログインに失敗しました";
    return Response.json(
      { error: message },
      { status: 502, headers: { "set-cookie": clearStateCookie(request) } },
    );
  }
}
