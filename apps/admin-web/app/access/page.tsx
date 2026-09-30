import { AccessRequests } from "./AccessRequests";
import Link from "next/link";

/** @brief 権限未登録の利用者にも申請と審査状況の入口を表示する */
export default async function AccessPage({ searchParams }: { searchParams: Promise<{ service?: string }> }) {
  const query = await searchParams;
  return <main className="service-home access-page">
    <header><p className="eyebrow">PandD / ACCESS</p><h1>利用申請</h1>
      <p>GitHubでログインして申請すると、運営が確認して利用権限を付与します。</p>
      <nav><Link href="/">サービス一覧</Link> · <a href="/game">ゲーム管理</a> · <a href="/music">Music管理</a></nav>
    </header>
    <AccessRequests initialService={query.service === "music" ? "music" : "game"} />
  </main>;
}
