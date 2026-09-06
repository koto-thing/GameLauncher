import {
  githubFlowVerifier,
  githubCallback,
  clearStateCookie,
  createSessionCookie,
  githubClientConfig,
  type SessionUser,
  verifyGithubIdentity,
} from "@/lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const verifier = state ? await githubFlowVerifier(request, state) : null;
  if (!code || !verifier) {
    return Response.json(
      { error: "GitHub OAuth stateが一致しません" },
      { status: 400, headers: { "set-cookie": clearStateCookie(request) } },
    );
  }
  try {
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
    const actor: SessionUser = await verifyGithubIdentity(tokenPayload.access_token);
    const headers = new Headers({ location: actor.gameAccess ? "/" : "/music" });
    headers.append("set-cookie", await createSessionCookie(actor, request));
    headers.append("set-cookie", clearStateCookie(request));
    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHubログインに失敗しました";
    return Response.json(
      { error: message },
      { status: 502, headers: { "set-cookie": clearStateCookie(request) } },
    );
  }
}
