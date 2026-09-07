"use client";

/**
 * 画面描画中の例外を安全なメッセージへ置き換え、再試行操作を提供するエラー画面
 * @param reset 現在のルートを再描画するNext.js提供の関数
 * @returns 認証情報や内部エラーを露出しない再試行画面
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="signin-shell">
      <section className="signin-card">
        <p className="eyebrow">CONTROL PLANE ERROR</p>
        <h1>画面を読み込めませんでした。</h1>
        <p>秘密情報を表示せずに処理を停止しました。状態を再取得してください。</p>
        <button className="primary-button" onClick={reset}>
          再試行
        </button>
      </section>
    </main>
  );
}
