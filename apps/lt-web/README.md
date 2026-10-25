# LT 公開・本人 UI（初期実装）

`npm ci` 後、`npm run dev`。ローカル Vite Plus 1.4.0 を使用する。
`VITE_LT_FIXTURE=true` を環境変数で設定すると開発サーバーだけ架空の開催回一覧を返す。通常 build は fixture を選択せず、同一オリジン `/api/lt/v1` に実リクエストする。接続先未設定で成功を装わない。
ローカル Rust API への接続は `.env.local` の `LT_API_PROXY=http://127.0.0.1:ポート`。本番は同一オリジン reverse proxy と SPA fallback、Referrer-Policy:no-referrer が必要。外部配信物なし。

確認ページ GET は token を交換せず URL から除去し、確認ボタンで POST する。再読込後はメールから再開する。認可・期限・状態競合はサーバーの結果を表示する。24時間 session を有効化しない。

検証: vp check、tsc、vp test run (7件)、vp build。ブラウザー接続はタイムアウトし、スマホ/PC・キーボード・繰返し操作・戻る・中断の実ブラウザー検証とスクリーンショットは未実施。

未解決: backend 結合、session GET/ログアウト画面、ページング、複数発表者の編集、開催回選択 UI、各状態の本人 fixture、送信結果不明時の同一 operationId 再試行、CSRF の backend 方式との結合。現在のフォームは単一発表者を対象とするため、複数発表者の既存申請編集には使用しないこと。資料 URL の server-side scheme 検証も結合時に必須。公開済み詳細は公開 DTO のみ参照する。

配色は共有設計の参考値より実際の apps/admin-web/app/globals.css を優先し、#faf7f8 / #ffffff / #383838 / #ff607b を採用。
