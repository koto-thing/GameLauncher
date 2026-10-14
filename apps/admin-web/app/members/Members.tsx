"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Role } from "@/lib/role-policy";
import "./members.css";

const labels = { user: "一般利用者", assistant: "幹部補佐", executive: "幹部", admin: "Admin" };
type Member = { id: string; login: string; role: Role };
type Data = { role: Role; users: Member[]; invitations: { id: string; role: Role; expires_at: string }[] };
type Mutation = (input: Record<string, unknown>, message: string) => Promise<void>;

/** @brief ログインが必要なエラーとその他の失敗を区別する */
class MemberError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** @brief APIの失敗を画面に伝え、成功時は既存のレスポンスを返す */
async function result(response: Response) {
  if (!response.ok) throw new MemberError(await response.text(), response.status);
  return response.json();
}

/** @brief 色だけに頼らず現在の役割を示す */
function RoleBadge({ role }: { role: Role }) {
  return <span className={`members-role members-role--${role}`}>{labels[role]}</span>;
}

/** @brief メンバー本人、現在の役割、Adminの変更操作を一行にまとめる */
function MemberRow({ user, canEdit, busy, mutate }: { user: Member; canEdit: boolean; busy: boolean; mutate: Mutation }) {
  const [role, setRole] = useState<Role>(user.role);

  /** @brief 明示的な保存操作でのみ役割を変更する */
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate({ action: "set_role", githubUserId: user.id, role }, `@${user.login} の役割を変更しました。`);
  }

  return <li className="members-row">
    <div className="members-person">
      <span className="members-avatar" aria-hidden="true">{user.login.slice(0, 2).toUpperCase()}</span>
      <div><strong>@{user.login}</strong><span className="members-id">GitHub ID: {user.id}</span></div>
    </div>
    <RoleBadge role={user.role} />
    {canEdit && <form className="members-role-form" onSubmit={save} aria-label={`@${user.login} の役割変更`}>
      <label className="members-sr-only" htmlFor={`role-${user.id}`}>@{user.login} の新しい役割</label>
      <select id={`role-${user.id}`} name="role" value={role} disabled={busy} onChange={(event) => setRole(event.target.value as Role)}>
        {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button className="secondary-button" disabled={busy || role === user.role} aria-label={`@${user.login} の役割を保存`}>保存</button>
    </form>}
  </li>;
}

/** @brief 一般利用者は招待受諾、幹部は補佐招待、Adminは役割変更を行う */
export function Members() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/members", { cache: "no-store", signal: controller.signal }).then(result).then((value: Data) => {
      if (!controller.signal.aborted) setData(value);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) {
        setNeedsSignIn(failure instanceof MemberError && failure.status === 401);
        setError(failure instanceof Error ? failure.message : "メンバー情報を取得できませんでした。");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [version]);

  /** @brief 初回取得の失敗後に読み込み状態を示して再試行する */
  function retry() {
    setError("");
    setNeedsSignIn(false);
    setLoading(true);
    setVersion((value) => value + 1);
  }

  /** @brief 書き込みと最新権限の再取得が完了するまで二重操作を防ぐ */
  async function mutate(input: Record<string, unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    let saved = false;
    try {
      await result(await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }));
      saved = true;
      setNotice(message);
      setData(await result(await fetch("/api/members", { cache: "no-store" })));
    } catch (failure) {
      const signIn = failure instanceof MemberError && failure.status === 401;
      setNeedsSignIn(signIn);
      if (saved || signIn) setData(null);
      setError(saved ? "保存は完了しましたが、最新の情報を取得できませんでした。再読み込みしてください。" : failure instanceof Error ? failure.message : "操作に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  /** @brief 登録済みGitHub本人と役割を明示して招待する */
  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void mutate({ action: "invite", githubUserId: fields.get("id"), role: fields.get("role") }, "招待を作成しました。招待された方は、この画面で受諾できます。");
  }

  const canInvite = data?.role === "admin" || data?.role === "executive";
  const invitees = data?.users.filter((user) => user.role === "user") ?? [];
  const search = query.trim().toLowerCase();
  const users = data?.users.filter((user) => `${user.login} ${user.id}`.toLowerCase().includes(search)) ?? [];

  return <div className="members-content">
    {notice && <p className="members-message members-message--success" role="status">{notice}</p>}
    {error && !needsSignIn && <div className="members-message members-message--error" role="alert"><strong>情報を確認してください</strong><p>{error}</p></div>}
    {loading ? <div className="members-card members-state" role="status"><span className="members-state-mark" aria-hidden="true">…</span><h2>メンバー情報を読み込み中</h2><p>現在の役割と招待を確認しています。</p></div> : !data ? <div className="members-card members-state">
      <span className="members-state-mark" aria-hidden="true">{needsSignIn ? "→" : "!"}</span>
      <h2>{needsSignIn ? "GitHubでログイン" : "メンバー情報を取得できませんでした"}</h2>
      <p>{needsSignIn ? "現在の役割や届いた招待を確認するには、ログインしてください。" : "接続を確認して、もう一度お試しください。"}</p>
      {needsSignIn ? <a className="primary-link" href="/api/auth/github/start">GitHubでログイン</a> : <button className="secondary-button" onClick={retry} disabled={busy}>再読み込み</button>}
    </div> : <>
      <div className="members-overview">
        <div className="members-current-role"><span>あなたの役割</span><RoleBadge role={data.role} /></div>
        <p>運営メンバーは全作品を公開・復旧できます。</p>
      </div>
      {busy && <p className="members-progress" role="status">処理中です。最新の情報を確認しています…</p>}
      {data.invitations.length > 0 && <section className="members-card members-invitations" aria-labelledby="invitations-heading">
        <div className="members-card-heading"><h2 id="invitations-heading">あなたへの招待</h2><span className="members-count">{data.invitations.length} 件</span></div>
        <ul>{data.invitations.map((invitation) => <li key={invitation.id}>
          <div><p><RoleBadge role={invitation.role} /> への招待が届いています</p><span className="members-help">有効期限：<time dateTime={invitation.expires_at}>{new Date(invitation.expires_at).toLocaleString("ja-JP")}</time></span></div>
          <button className="primary-button" disabled={busy} onClick={() => void mutate({ action: "accept", id: invitation.id }, "招待を受諾しました。現在の役割を更新しました。")}>招待を受諾</button>
        </li>)}</ul>
      </section>}
      {canInvite ? <div className="members-grid">
        <section className="members-card members-directory" aria-labelledby="directory-heading">
          <div className="members-card-heading"><div><h2 id="directory-heading">登録メンバー <span className="members-count">{data.users.length} 名</span></h2><p>{data.role === "admin" ? "役割を選択し、保存すると反映されます。" : "登録済みのメンバーと現在の役割を確認できます。"}</p></div></div>
          <div className="members-search"><label htmlFor="member-search">メンバーを検索</label><input id="member-search" type="search" placeholder="GitHubユーザー名・ID" value={query} onChange={(event) => setQuery(event.target.value)} /><span className="members-help" role="status">{search ? `${users.length} 名が一致` : "GitHubでログイン済みのユーザーを表示しています。"}</span></div>
          {users.length > 0 ? <>
            <div className={`members-list-heading ${data.role === "admin" ? "members-list-heading--editable" : ""}`} aria-hidden="true"><span>メンバー</span><span>現在の役割</span>{data.role === "admin" && <span>役割の変更</span>}</div>
            <ul className={`members-list ${data.role === "admin" ? "members-list--editable" : ""}`}>{users.map((user) => <MemberRow key={`${user.id}:${user.role}`} user={user} canEdit={data.role === "admin"} busy={busy} mutate={mutate} />)}</ul>
          </> : <div className="members-empty"><h3>{search ? "一致するメンバーがいません" : "登録メンバーがいません"}</h3><p>{search ? "ユーザー名やIDを変えて検索してください。" : "GitHubでログインしたユーザーがここに表示されます。"}</p>{search && <button className="secondary-button" onClick={() => setQuery("")}>検索をクリア</button>}</div>}
        </section>
        <aside className="members-sidebar">
          <section className="members-card members-invite" aria-labelledby="invite-heading">
            <span className="members-kicker">INVITE MEMBER</span><h2 id="invite-heading">メンバーを招待</h2><p className="members-help">一般利用者を運営チームに招待します。本人が受諾すると役割が反映されます。</p>
            {invitees.length > 0 ? <form onSubmit={invite}>
              <label htmlFor="invite-person">招待する人</label><select id="invite-person" name="id" required disabled={busy} defaultValue=""><option value="" disabled>メンバーを選択</option>{invitees.map((user) => <option key={user.id} value={user.id}>@{user.login}（{user.id}）</option>)}</select>
              <label htmlFor="invite-role">招待する役割</label><select id="invite-role" name="role" disabled={busy}><option value="assistant">幹部補佐</option>{data.role === "admin" && <option value="executive">幹部</option>}</select>
              <button className="primary-button" disabled={busy}>招待を作成</button>
            </form> : <div className="members-invite-empty"><strong>招待できるユーザーがいません</strong><p>一般利用者が登録されると、ここで選択できます。</p></div>}
            <p className="members-invite-note">招待する方に、先にGitHubで一度ログインしてもらってください。</p>
          </section>
          <div className="members-role-guide"><h3>役割について</h3><p>幹部・幹部補佐は全作品の公開と復旧ができます。幹部は幹部補佐を招待でき、Adminはすべての役割を変更できます。</p></div>
        </aside>
      </div> : data.invitations.length === 0 && <section className="members-card members-state"><span className="members-state-mark" aria-hidden="true">✓</span><h2>現在、届いている招待はありません</h2><p>あなた宛の招待が届くと、ここで内容を確認して受諾できます。</p></section>}
    </>}
  </div>;
}
