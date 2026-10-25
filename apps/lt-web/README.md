# LT 公開・本人 UI（初期実装）

`npm ci` 後、`npm run dev`。ローカル Vite Plus 1.4.0 を使用する。
`VITE_LT_FIXTURE=true` を環境変数で設定すると開発サーバーだけ架空の開催回一覧を返す。通常 build は fixture を選択せず、同一オリジン `/api/lt/v1` に実リクエストする。接続先未設定で成功を装わない。
ローカル Rust API への接続は `.env.local` の `LT_API_PROXY=http://127.0.0.1:ポート`。本番は同一オリジン reverse proxy と SPA fallback、Referrer-Policy:no-referrer が必要。外部配信物なし。

確認ページ GET は token を交換せず URL から除去し、確認ボタンで POST する。再読込後はメールから再開する。認可・期限・状態競合はサーバーの結果を表示する。24時間 session を有効化しない。

検証: vp check、tsc、vp test run (7件)、vp build。ブラウザー接続はタイムアウトし、スマホ/PC・キーボード・繰返し操作・戻る・中断の実ブラウザー検証とスクリーンショットは未実施。

未解決: backend 結合、session GET/ログアウト画面、ページング、複数発表者の編集、開催回選択 UI、各状態の本人 fixture、送信結果不明時の同一 operationId 再試行、CSRF の backend 方式との結合。現在のフォームは単一発表者を対象とするため、複数発表者の既存申請編集には使用しないこと。資料 URL の server-side scheme 検証も結合時に必須。公開済み詳細は公開 DTO のみ参照する。

配色は共有設計の参考値より実際の apps/admin-web/app/globals.css を優先し、#faf7f8 / #ffffff / #383838 / #ff607b を採用。

## 追補実装
本人 session GET と logout POST は共有 routes に定義済みのため実装。開催回選択、複数発表者の追加/削除/氏名・所属・紹介編集、状態別の架空申請 fixture、一覧の次ページ操作を追加。フォームは資料 URL を http/https に制限。結果不明の mutation は同一 payload に同じ operationId をメモリー内で再利用する（画面再読込をまたぐ永続保持は未実装）。

最新検証: vp check --fix / tsc / vp test run（9件）/ vp build 成功。React server rendering の component テストで複数発表者の保持を確認。
ブラウザー再試行: iab unavailable、利用可能 Chrome でも localhost 接続は ERR_CONNECTION_TIMED_OUT。スクリーンショットと実操作 QA は未実施。
CSRF: 同一オリジン API + credentials:same-origin のみ。ブラウザーの Origin を変更する独自ヘッダーは送らない。backend で Origin 完全一致、Secure/HttpOnly/SameSite cookie、mutation の JSON Content-Type 制限を確認する必要がある。UI 単体で CSRF 検証済みとはしない。
配色根拠: clean master f0179f2a3242e26e0dd1d81ddb87162e88415a03 の apps/admin-web/app/globals.css。paper #faf7f8、panel #ffffff、ink #383838、muted #70666a、line #e5dce0、input-line #a2949a、accent #ff607b、accent-hover #f24e6c、accent-ink #a32948。
先の未解決一覧のうち session/複数発表者/開催回選択/状態別 fixture/次ページは実装済み。未解決は backend 結合、実ブラウザー QA、cursor の履歴保存、開催回選択肢の全ページ取得、operationId の再読込後保持、状態変更 mutation の結合検証。
