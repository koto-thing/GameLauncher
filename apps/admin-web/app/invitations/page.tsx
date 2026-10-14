"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import "../members/members.css";
type Invitation = {id:string; login:string; role:"admin"|"executive"|"assistant"; expires_at:string};

/** @brief 招待された本人だけが通常セッションを取得するための受諾画面 */
export default function InvitationPage() {
  const router = useRouter();
  const [invitation,setInvitation] = useState<Invitation|null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/invitations",{cache:"no-store",signal:controller.signal}).then(async response => {
      if (!response.ok) throw new Error(await response.text());
      setInvitation(await response.json());
    }).catch(error => { if (!controller.signal.aborted) setError(String(error.message)); });
    return () => controller.abort();
  },[]);

  /** @brief サーバーの受諾処理が成功するまで管理画面には進めない */
  async function accept() {
    setBusy(true);
    try {
      const response = await fetch("/api/invitations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:invitation?.id})});
      if (!response.ok) throw new Error(await response.text());
      router.push("/members");
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "受諾できませんでした"); }
    finally { setBusy(false); }
  }
  return <main className="members-page"><header className="members-page-heading"><p className="members-kicker">INVITATION</p><h1>運営への招待</h1></header>
    <section className="members-card members-state">
      {error ? <><p role="alert">{error}</p><a className="primary-link" href="/api/auth/github/start">GitHubで再確認</a></> : invitation ? <>
        <h2>@{invitation.login}</h2><p>{({admin:"Admin",executive:"幹部",assistant:"幹部補佐"})[invitation.role]} として参加します。</p>
        <p>受諾前は運営機能を利用できません。本人確認は10分間有効です。</p>
        <button className="primary-button" disabled={busy} onClick={() => void accept()}>招待を受諾</button>
      </> : <p role="status">招待を確認中…</p>}
    </section></main>;
}
