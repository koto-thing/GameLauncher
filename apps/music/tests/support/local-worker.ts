import worker, { compose } from "../../src/composition/server";
import type { MusicEnv } from "../../src/config/server-config";

// このファイルは本番エントリーからimportしない。隔離サーバーとテストだけでbundleする。
export default {
  /** @brief 固定fixtureのログインをloopback環境だけに限定する。 */
  async fetch(
    request: Request,
    env: MusicEnv,
    context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/local/login") {
      if (
        env.ENVIRONMENT !== "local" ||
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        request.method !== "POST" ||
        request.headers.get("Origin") !== env.SITE_ORIGIN
      )
        return new Response("Not found", { status: 404 });
      const value = (await request.json()) as { account?: string };
      const accounts: Record<string, string> = {
        admin: "900001",
        "composer-a": "900002",
        "composer-b": "900003",
        outsider: "900004",
      };
      const id = accounts[value.account ?? ""];
      if (!id) return new Response("Unknown fixture", { status: 400 });
      const { auth, config } = compose(env);
      const result = await auth.issue(id);
      return Response.json(
        { ok: true },
        {
          headers: {
            "Set-Cookie": `music_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${config.sessionSeconds}`,
            "Cache-Control": "no-store",
          },
        },
      );
    }
    return worker.fetch(request, env, context);
  },
};
