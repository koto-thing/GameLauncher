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

## 本人認証・申請の開発限定縦断（追補）

`worker-build --release . --features local-development` と `LOCAL_AUTH=true` の両方が必要。通常 build は本人 endpoint を501にし、本番有効化していない。開発用設定は APP_ORIGIN=http://127.0.0.1:8787、SESSION_HOURS=24（1〜24に制限）。UI の実ブラウザー cookie 動作は未検証。

実装: email request、GET確認（非消費・URL除去）、POST交換、session GET、logout、本人申請一覧/detail、新規提出、許可状態の本文編集。token/sessionはWebCrypto乱数256bit、SHA-256保存。tokenはlogin purpose/1時間、一回の条件付きUPDATEで消費とsession発行を原子的に処理。host-only __Host- cookie、HttpOnly/Secure/SameSite=Strict。変更操作は厳密OriginとX-LT-CSRFとJSONを要求。fake mailは隔離したローカルDBだけに保存し、HTTPで取得するtest bypassは存在しない。テスト側がWrangler local D1管理ポートから取得する。

提出時に本文・資料URL・未知キー・受付期間・親状態・満枠を再検証。同一本人/回の有効申請はunique制約。編集は所有者とversionと許可状態を検証し、公開済み版を変更しない。operation receipt と衝突をSQL制約で守る。エラーfieldsの詳細化、保持期限の完全な適用、全操作の厳格Schema自動導出は残作業。

追加検証: actual local Worker/D1 本人4テスト成功（確認→申請→一覧→編集、IDOR、token replay、session/token期限、Origin、同時重複、schema/閉鎖）。公開回帰3テスト成功（募集開始前の全経路非公開、必須欠落、title object canary、speaker.profile object canary）。公開催日時はlt_events.public_opens_at、未設定は非公開。公開DTOは未知キーと不正型を拒否する具体型。未承認snapshot生成の原子的制御は運営実装まで未完成であり、未承認排除を完了扱いにしない。

本人試験: `python tests/applicant_runtime_test.py -v`。公開ガード試験: `python tests/public_guard_test.py -v`。fixtureは0003以降に投入可能。リセットには別の空ローカルDBを使用し、本番操作はしない。
