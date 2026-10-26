# 公開UIと画面モックの対応

参照はユーザー提供の `LT_site_mock_bundle_v0.2(1).zip` 内のHTML。親タスクから分割された本文を復元し、UTF-8 74,426 bytes、SHA256 `ede482974c70910a05b2c56dfad388ac61835ec973437435dc427ef3e75d9769` の一致を確認した。

- v0.2最終パレット（背景 `#faf7f8`、文字 `#383838`、アクセント `#ff607b`）、白いブランドヘッダー、4つの公開タブ、開催タイトル・状態・操作、4項目の情報欄、発表一覧と募集案内の2列をReactへ移した
- 390pxではタブ2行・情報欄2×2・カード縦積み。元HTMLと復元画面を1280px／390pxで目視比較した
- デモの画面モード切替・初期化・認証代用・架空開催は本番へ移さない。実データ0件ではモックに存在する空状態を表示する
- 申請・メール停止案内とdisabledボタンを維持。聴講条件など公開DTOにない開催条件は架空の値で補わない
- 公開の開催回・発表DTOのみ使用。日時は開催回のtimeZoneで表示し、発表詳細の既存URLを保つ
- Worker・Rust・DB・メール・cron・保持削除の設定には変更なし。公開GET以外を拒否する既存Workerテストを維持する

検証: `apps/lt-web` で `npm test`、`node --test worker.test.mjs`、`npm run check`、`npx --no-install tsc --noEmit`、`npm run build`、`npx --no-install playwright test`、`npx --no-install playwright test --config playwright.readonly.config.ts`。後者はデータ有無×1280/390pxの4件で、配色・列数・横溢れ・停止中の直接URL・私有API非呼出しも確認する。スクリーンショットはローカル検証用で、公開assetへ含めない。
