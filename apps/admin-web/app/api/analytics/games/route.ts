import { env } from "cloudflare:workers";
import { readSession } from "@/lib/auth";
import { analyticsResponse, type AnalyticsBinding } from "@/lib/analytics";

type AnalyticsEnv = {
  PLATFORM_API?: AnalyticsBinding;
  PLATFORM_API_STAGING?: AnalyticsBinding;
  ANALYTICS_READ_TOKEN?: string;
  ANALYTICS_READ_TOKEN_STAGING?: string;
};

/** @brief 署名済みセッションを確認して管理者へゲーム統計だけを返す */
export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await readSession(request);
    const configuration = env as unknown as AnalyticsEnv;
    const staging = new URL(request.url).searchParams.get("environment") === "staging";
    // 認証と検索条件の検証を終えたanalyticsResponseだけが選択済みBindingへ接続する
    return await analyticsResponse(request, actor,
      staging ? configuration.PLATFORM_API_STAGING : configuration.PLATFORM_API,
      staging ? configuration.ANALYTICS_READ_TOKEN_STAGING : configuration.ANALYTICS_READ_TOKEN);
  } catch {
    return Response.json({ error: "統計の認証を確認できませんでした。ログインし直してください" }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }
}
