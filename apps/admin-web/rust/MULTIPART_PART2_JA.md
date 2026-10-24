# 管理 multipart 検証 Rust 移行 Part2

Part1 の Wasm にパート番号判定と期待容量計算を追加し、既存の expectedPartSize から呼び出す
DB と R2、認証、エラー文言、検証の順序、再試行処理は既存のまま維持する
整数への容量変換を避け、JavaScript と同じ f64 の演算順を使う

## 検証

node apps/admin-web/scripts/build-intake-policy.js
node --test apps/admin-web/tests/multipart-policy.test.mjs

実際の Wasm を使い、安全整数境界、非整数、NaN、無限大、容量の桁あふれを旧式と比較する
Worker 全体の build、全テスト、lint、型チェック、dry-run と認証付き upload/record/seal の workerd 実行検証を実施
JSON の文字列、真偽値、null、配列、オブジェクトは Wasm ABI の変換前に拒否し、保存済みパートが増えないことを確認
LOCAL_DEV_AUTH と SESSION_SECRET はテスト専用 binding だけで指定する
Music の追加が同じ intake-policy.rs または wrapper に触れる場合は手動統合が必要
共有 CI や配信設定は変更していない

## 配信と復旧

Cloudflare Workers の既存 Wasm build を利用し、追加サービスや課金、binding 変更は不要
Part1 を先に統合し、統合 SHA で Worker 検証後に親の承認を得て配信する
復旧はこのコミットの revert と再 build、または直前の Worker version へ戻す
この作業では merge と deploy を実施しない
