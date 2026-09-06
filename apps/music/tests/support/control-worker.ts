import { musicApi } from "../../../admin-web/music/presentation/api";
import { GET as login } from "../../../admin-web/app/api/auth/dev/route";
import { GET as dashboard } from "../../../admin-web/app/api/dashboard/route";
import { POST as control } from "../../../admin-web/app/api/control/route";
import { POST as logout } from "../../../admin-web/app/api/auth/logout/route";
import { GET as intakeConfig } from "../../../admin-web/app/api/intake/config/route";
import { POST as intakeUpload } from "../../../admin-web/app/api/intake/uploads/route";
import { POST as preflight } from "../../../admin-web/app/api/actions/preflight/route";
import { GET as services } from "../../../admin-web/app/api/auth/services/route";
import { GET as oauthStart } from "../../../admin-web/app/api/auth/github/start/route";
import { GET as oauthCallback } from "../../../admin-web/app/api/auth/github/callback/route";
import {
  verifyGithubIdentity,
  verifyGithubToken,
} from "../../../admin-web/lib/auth";
import { getD1 } from "../../../admin-web/db/initialize";

// テスト用のHTTP配送だけを定義し、認証・ゲーム・Musicの本物のサーバー入口を実行する。
export default {
  /** @brief ローカルD1と実PHPに本番と同じUse Caseをつなぐ。 @param request 統合テスト要求。 @returns 実API応答。 */
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/__test/db") {
      const { queries } = (await request.json()) as {
        queries: { sql: string; values: unknown[] }[];
      };
      return Response.json(
        await getD1().batch(
          queries.map(
            /** @brief テストfixtureのSQLを実D1へ適用する。 */ (query) =>
              getD1()
                .prepare(query.sql)
                .bind(...query.values),
          ),
        ),
      );
    }
    if (path.startsWith("/api/music/")) return musicApi(request);
    if (path === "/api/auth/dev") return login(request);
    if (path === "/api/auth/services") return services(request);
    if (path === "/api/auth/github/start") return oauthStart(request);
    if (path === "/api/auth/github/callback") return oauthCallback(request);
    if (path === "/api/dashboard") return dashboard(request);
    if (path === "/api/control") return control(request);
    if (path === "/api/auth/logout") return logout(request);
    if (path === "/api/intake/config") return intakeConfig(request);
    if (path === "/api/intake/uploads") return intakeUpload(request);
    if (path === "/api/actions/preflight") return preflight(request);
    // GitHubへの実接続を起こさず本人確認の外部境界を試験する専用入口。
    if (path === "/__test/identity") {
      try {
        return Response.json(
          await (new URL(request.url).searchParams.has("game")
            ? verifyGithubToken("test")
            : verifyGithubIdentity("test")),
        );
      } catch (failure) {
        return failure instanceof Response
          ? failure
          : new Response("identity failed", { status: 403 });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
