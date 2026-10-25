import { useRef, useState } from "react";
import type { EmailAccepted, EmailChangeVerificationInput } from "../../../contracts/lt/v1";
import { request } from "./api";
// token はメモリーだけに保持し、GET 表示では消費しない
let initialToken =
  location.pathname === "/auth/email-change"
    ? new URLSearchParams(location.search).get("token")
    : null;
if (location.pathname === "/auth/email-change") history.replaceState(null, "", location.pathname);
/** 新アドレスの確認だけを行い、ログインや所有者変更を行わない */
export function EmailChange() {
  const token = useRef(initialToken),
    locked = useRef(false);
  const [state, setState] = useState<"ready" | "sending" | "verified" | "invalid" | "uncertain">(
    initialToken ? "ready" : "invalid",
  );
  async function verify() {
    if (locked.current || !token.current) return;
    locked.current = true;
    initialToken = null;
    setState("sending");
    try {
      const input: EmailChangeVerificationInput = { token: token.current };
      await request<EmailAccepted>("/auth/email-change/verify", {
        method: "POST",
        body: JSON.stringify(input),
      });
      token.current = null;
      setState("verified");
    } catch {
      token.current = null;
      setState("uncertain");
    }
  }
  return (
    <main>
      {import.meta.env.DEV && import.meta.env.VITE_LT_QA === "true" && (
        <aside>開発 fixture・架空データ／API 未接続</aside>
      )}
      <section>
        <h1>新しいメールアドレスの確認</h1>
        <p>この操作ではログインも申請所有者の変更も行いません。運営による最終確定が必要です。</p>
        {state === "ready" && (
          <>
            <p>確認リンクは1時間有効です。新しい確認案内の再送後は以前のリンクを使用できません。</p>
            <button onClick={() => void verify()}>メールアドレスを確認する</button>
          </>
        )}
        {state === "sending" && <p role="status">確認中…</p>}
        {state === "verified" && (
          <p role="status">メールアドレスを確認しました。運営の最終確定をお待ちください。</p>
        )}
        {state === "invalid" && (
          <p role="alert">
            確認リンクがありません。確認済みの場合は運営の最終確定をお待ちください。未確認の場合は運営に新しい案内を依頼してください。
          </p>
        )}
        {state === "uncertain" && (
          <p role="alert">
            確認結果を取得できませんでした。既に確認済み、期限切れ、不正、再送により無効になったリンクの可能性があります。自動で再送しません。運営に確認状態を問い合わせ、必要な場合だけ新しい案内を依頼してください。
          </p>
        )}
      </section>
    </main>
  );
}
