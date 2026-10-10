import type { Metadata } from "next";
import { headers } from "next/headers";
import { localDevAuthAvailable, readSession } from "@/lib/auth";
import { defaultAnalyticsPeriod, requireAnalyticsAdmin } from "@/lib/analytics";
import { ServiceNavigation } from "../ServiceNavigation";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import "./analytics.css";

export const metadata: Metadata = { title: "ゲーム利用統計 | PandD" };

/** @brief サーバーで本人と運営管理者権限を確認して統計画面を表示する */
export default async function AnalyticsPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  const origin = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? `http://${host}` : "https://admin.invalid";
  const request = new Request(`${origin}/analytics`, { headers: Array.from(requestHeaders.entries()) });
  let status = 200;
  try { requireAnalyticsAdmin(await readSession(request)); }
  catch (error) { status = error instanceof Response ? error.status : 503; }

  return <>
    <ServiceNavigation />
    {status === 200 ? <AnalyticsDashboard initialPeriod={defaultAnalyticsPeriod()} /> : <main className="analytics-page">
      <p className="eyebrow">GAMELAUNCHER / ANALYTICS</p><h1>ゲーム利用統計</h1>
      <p role="alert">{status === 401 ? "統計を見るにはGitHubでログインしてください" : status === 403 ? "統計は運営管理者のみ閲覧できます" : "認証を確認できませんでした。接続設定を確認してください"}</p>
      <a className="primary-link" href="/api/auth/github/start">GitHubでログイン</a>
      {localDevAuthAvailable(request) && <p><a href="/api/auth/dev?as=admin">ローカル開発用の管理者でログイン</a></p>}
    </main>}
  </>;
}
