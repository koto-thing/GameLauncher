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

## preview 診断と再送の永続化

5177 はホスト側 Get-NetTCPConnection で 127.0.0.1 LISTEN（PID58992）を確認したが HTTP GET は5秒 timeout。strictPort 再起動は競合で終了コード1。設定変更せず5178へ fixture dev を起動すると HTTP200、Chrome の一覧 DOM（fixture 明示・開催回・次ページ）を確認できた。その後の本人申請クリックは CDP DOM.getContentQuads timeout のため PC/スマホ幅/キーボード/二重送信の完遂には至らず、スクリーンショット未取得。
再送 ID は sessionStorage にランダム operationId と SHA-256 指紋のみを保持。本文・メール・token は保存しない。同じタブの再読込後も同じ payload の操作を照合可能。成功したフォーム操作は削除。状態 mutation は version を指紋に含み、再読込後の version 変化で別操作となる。
独立レビュー対応: /applications/:id を detail API にルーティング、本人詳細と一覧へ戻るを追加。複数発表者の affiliation/profile 保持テスト済み。登壇中止と発表開始終了を追加。時間割/詳細は一覧に存在する開催回の timeZone を使用（一覧外の回は UTC 原文となるため、イベント detail の独立取得が残課題）。cursor の URL 記録と popstate 復元を追加したがブラウザー実証は未完了。開催回選択肢の全ページ取得と要求されたエラー状態のブラウザー試験は未完了。

## 最新の完了範囲

開催回選択肢は nextCursor がなくなるまで全ページを取得し、同じ cursor の循環はエラーにする。直接発表詳細を開く場合も対象 event detail を独立取得し、timeZone が取得できるまで本文の成功表示へ進まない。取得失敗を UTC 原文へ置き換えない。
詳細/登壇中止/本人編集/辞退取消/期限切れ/未認証/競合 fixture と結合テストを追加。JST の日付跨ぎ、任意 description の欠落、発表者任意情報の保持を検証。
最終チェック: vp check --fix、tsc、vp test run（5ファイル14件）、vp build 成功。
ブラウザー QA は未完了。プロジェクト node_modules の playwright / @playwright/test と通常 ms-playwright cache は存在しないことを読み取り確認。Chrome CDP のタイムアウトを繰り返さず停止。公式 Playwright の専用 context 検証は未実施で、既存通常ブラウザー設定やセッションを変更していない。
fixture mutation は API の実認証/永続保存を証明しない。PATCH/辞退取消の応答だけをメモリー上で模擬し、一覧再取得時に元データとなる制限がある。backend 結合の前提である。

## 専用 Chrome E2E 最終結果

公式 @playwright/test をプロジェクト開発依存として追加。既存 Chrome を headless の一時 context で起動し、通常プロファイルを使用しない。e2e/flows.spec.ts の route adapter はテスト内で状態と operationId receipt を保持し、再読込をまたいだ申請一覧の更新を確認する。実APIへの送信は route interception により遮断。
3ケース成功: PC の新規申請→複数発表者→二重クリック保存→編集→再読込→戻る、390px の差し戻し→キーボード Enter 再提出→辞退依頼→取消、期限切れ/401/409/503 のエラー表示。最初の実行では戻る遷移に古いDTOが描画される不具合を検出し、nav/popstateでdataを消す修正後に全成功。
qa/desktop.png と qa/mobile.png を保存し、実画像を目視。横はみ出し・重なりなし。fixture明示あり。実バックエンド結合・本番cookie/Originの確認は別工程。
実行: npm exec -- playwright test。vp dev を5180へ自動起動し、テスト終了時に停止する。テストは通常 build へ含めない。

## CSRF ヘッダー接続

POST/PUT/PATCH/DELETE に X-LT-CSRF:1 と application/json を強制し、GET には付けない。credentials:same-origin を維持し、絶対URL/ネットワークパスを拒否、redirect:error で外部転送を防ぐ。サーバーの Origin 完全一致検証と cookie 認証を置き換えない。backend 実結合は別工程。

## 公開メール変更確認

/auth/email-change の GET は token をメモリーへ取り込み URL から除去するだけで消費しない。明示ボタンで専用 /auth/email-change/verify に token のみ POST。session GET/ログイン交換/所有者変更は呼ばない。連打は ref で同期的に排除。成功時も運営の最終確定待ちと表示。token は storage/ログ/分析へ保存しない。再読込後は案内再取得を促す。
共有契約は失効原因別の判別DTOを提供しないため、期限切れ/使用済み/不正/再送失効/通信結果不明を断定せず安全な共通案内にする。エラー後は自動再送せず運営への確認を促す。確認済みの再アクセスも新規の所有者変更として扱わない。productionEnabled:false のままで、実接続・実メール検証は未実施。
最新検証: vp check/tsc/vp test run22件/vp build成功。専用Chromeで新規5ケースと既存4ケースの全9 E2E成功。PC1280/390px、GET非消費、cookie未作成、連打、戻る/再読込、400/410/503を検証。qa/email-change-1280.png・email-change-390.png 保存、390px画像を目視し重なりなし。
