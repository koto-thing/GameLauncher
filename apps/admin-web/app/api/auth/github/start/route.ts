import { beginGithubFlow } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const flow = await beginGithubFlow(request);
    return new Response(null, {
      status: 302,
      headers: {
        location: flow.url,
        "set-cookie": flow.cookie,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHubログインを開始できません";
    return Response.json({ error: message }, { status: 503 });
  }
}
