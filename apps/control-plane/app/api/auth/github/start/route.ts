import { createStateCookie, githubClientConfig } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const { clientId } = githubClientConfig();
    const state = crypto.randomUUID();
    const callback = new URL("/api/auth/github/callback", request.url);
    const authorization = new URL("https://github.com/login/oauth/authorize");
    authorization.searchParams.set("client_id", clientId);
    authorization.searchParams.set("redirect_uri", callback.toString());
    authorization.searchParams.set("state", state);
    return new Response(null, {
      status: 302,
      headers: {
        location: authorization.toString(),
        "set-cookie": createStateCookie(state, request),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHubログインを開始できません";
    return Response.json({ error: message }, { status: 503 });
  }
}
