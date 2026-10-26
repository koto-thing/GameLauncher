import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { githubAuthConfigured, localDevAuthAvailable, readSession } from "@/lib/auth";
import { safeReturnTo } from "@/lib/login-navigation";

export const metadata = { title: "ログイン | PandD 管理画面" };

/** @brief 管理サービス共通のログイン入口を表示する */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const incoming = await headers();
  const host = incoming.get("host") ?? "localhost";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  const request = new Request(`${protocol}://${host}/login`, { headers: incoming });
  const returnTo = safeReturnTo((await searchParams).returnTo);

  if (await readSession(request)) redirect(returnTo);

  return (
    <main className="signin-shell">
      <section className="signin-card" aria-labelledby="login-title">
        <div className="brand signin-brand"><span className="brand-mark" aria-hidden="true">P</span><strong>PandD 管理画面</strong></div>
        <h1 id="login-title">ログイン</h1>
        <p>許可された運営メンバーのGitHubアカウントでログインしてください。</p>
        <p>ログインは6時間有効です。認証後は元の管理画面へ戻ります。</p>

        {githubAuthConfigured() ? (
          <a className="primary-link" href={`/api/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`}>GitHubでログイン</a>
        ) : <p className="setup-note" role="status">GitHubログインの設定が完了していません。管理者へお問い合わせください。</p>}

        {localDevAuthAvailable(request) && <div className="dev-login">
          <a href={`/api/auth/dev?as=admin&returnTo=${encodeURIComponent(returnTo)}`}>Adminとして確認</a>
          <a href={`/api/auth/dev?as=maintainer&returnTo=${encodeURIComponent(returnTo)}`}>申請者として確認</a>
          <a href={`/api/auth/dev?as=reviewer&returnTo=${encodeURIComponent(returnTo)}`}>承認者として確認</a>
        </div>}
      </section>
    </main>
  );
}
