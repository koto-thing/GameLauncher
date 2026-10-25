# LT 公開 API 最小縦断

共有追補 7c0e93d を cd2fd50 として取り込み済み。

実装: GET /api/lt/v1/events、同 /:eventId、同 /:eventId/talks/:talkId。時間割は契約の PublicEvent.schedule に含む。公開版だけを読み、親が draft/cancelled の場合は一覧・詳細・発表をすべて除外する。私有項目はネストも許可リストで除去。キャッシュは no-store。運営 URL は偽造 actor header でも404。

migration は公開読み取り用だけ。私有申請・承認・スケジュール更新は未実装。保存する DTO の完全な schema validation は未実装で、現在は fixture のみが書き込む。運営操作と承認処理を追加する前に書込 validator が必須。一覧は全件返却し nextCursor=null のため大量件数への対応は今後必要。

## ローカル再現

Rust 1.94.1、worker/worker-build 0.8.7、Wrangler 4.152.0。

```
npm ci
cargo install worker-build --version 0.8.7 --locked --root .tools
.tools/bin/worker-build --release
node node_modules/wrangler/bin/wrangler.js d1 migrations apply lt-local --local
node node_modules/wrangler/bin/wrangler.js d1 execute lt-local --local --file tests/fixture.sql
node node_modules/wrangler/bin/wrangler.js dev --local --port 8787 --ip 127.0.0.1
python tests/runtime_test.py -v
cargo check --locked --offline
cargo test --locked --offline
```

fixture は空のローカル DB に一度投入する。実メール・本番 DB・クラウド試験なし。database_id はローカル用ゼロ値。deploy は禁止。

2026-10-25 検証: migration/fixture 成功、cargo check/test 成功（単体1件）、最適化 Wasm build 成功、actual local Worker/D1 HTTP 6テスト成功。通常 sandbox の HTTP は WinError10013 で失敗し、正式な昇格で同じローカルテストを実行して成功。

bundle: Wasm 271951 bytes、JS 22899 bytes、shim 164 bytes（非圧縮）。fixture の HTTP はログ上約6〜15ms、6テスト全体0.218秒。これはローカル壁時計でCPU時間ではなく、無料枠適合を保証しない。CPU計測・クラウド試験未実施。

## 次の縦断

本人認証/申請は未着手。確認リンク1時間は確定、session24時間は設定可能な提案で本番無効。GET非消費、POST原子的交換、ハッシュ保存、Origin/CSRF、fake mail、所有者照合をまとめて実装する必要がある。token replay/期限/IDOR/同時申請/承認競合/outbox/保持 dry-run は未検証。未実装 API は501。

管理は別の公開 route/worker.dev のない Worker とサービス binding を予定。公開入口へ actor header 認可を追加しない。proxy は毎回在籍・roleを再検証し、OperatorContext を内部境界で渡す。API は role から capability を導出する。メール変更はadmin/executiveのみ、本人確認手順が未確定なので未対応を維持する。

公式参照: https://developers.cloudflare.com/workers/languages/rust/ 、https://developers.cloudflare.com/d1/worker-api/d1-database/ 。D1 batch の0行 UPDATE は停止条件にならないため、後続の承認実装は勝者 receipt に全副作用を従属させる。
