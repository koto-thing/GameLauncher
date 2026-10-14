"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Role } from "@/lib/role-policy";

const labels = { user: "一般利用者", assistant: "幹部補佐", executive: "幹部", admin: "Admin" };
type Data = { role: Role; users: { id: string; login: string; role: Role }[]; invitations: { id: string; role: Role; expires_at: string }[] };

/** @brief APIエラーの状態を保存せず画面へ伝える */
async function result(response: Response) {
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

/** @brief 一般利用者は招待受諾、幹部は補佐招待、Adminは役割変更を行う */
export function Members() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/members", { cache: "no-store", signal: controller.signal }).then(result).then((value: Data) => { if (!controller.signal.aborted) setData(value); }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [version]);

  /** @brief 書き込み後は最新のサーバー権限を再取得する */
  async function mutate(input: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      await result(await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }));
      setNotice("保存しました。招待先の方はこの画面で受諾できます。");
      setVersion((value) => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "操作に失敗しました"); }
    finally { setBusy(false); }
  }

  /** @brief 登録済みGitHub本人と役割を明示して招待する */
  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void mutate({ action: "invite", githubUserId: fields.get("id"), role: fields.get("role") });
  }

  return <section>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!data && <a href="/api/auth/github/start">GitHubでログイン</a>}
    {data && <>
      <p>現在の役割：{labels[data.role]}</p>
      <p>運営メンバーは全作品を公開・復旧できます。招待先の方は先にGitHubで一度ログインしてください。</p>
      {data.invitations.map((invitation) => <p key={invitation.id}>{labels[invitation.role]}への招待（期限 {invitation.expires_at}） <button disabled={busy} onClick={() => void mutate({ action: "accept", id: invitation.id })}>受諾する</button></p>)}
      {(data.role === "admin" || data.role === "executive") && <form onSubmit={invite}>
        <label>招待する人<select name="id" required>{data.users.filter((user) => user.role === "user").map((user) => <option key={user.id} value={user.id}>@{user.login}（{user.id}）</option>)}</select></label>
        <label>役割<select name="role" aria-label="招待する役割"><option value="assistant">幹部補佐</option>{data.role === "admin" && <option value="executive">幹部</option>}</select></label>
        <button disabled={busy}>招待を作成</button>
      </form>}
      {data.role === "admin" && data.users.map((user) => <form key={user.id} onSubmit={(event) => {
        event.preventDefault();
        void mutate({ action: "set_role", githubUserId: user.id, role: new FormData(event.currentTarget).get("role") });
      }}><label>@{user.login}（{user.id}）<select name="role" defaultValue={user.role}>{Object.entries(labels).map(([role,label]) => <option key={role} value={role}>{label}</option>)}</select></label><button disabled={busy}>役割を変更</button></form>)}
    </>}
  </section>;
}
