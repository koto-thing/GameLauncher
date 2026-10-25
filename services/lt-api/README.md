# LT API（ローカル実装）

公開・本人・内部運営の共有routeをRust Worker/D1で実装。例外メール変更3routeは次の分割実装として未対応。実メール・本番DB・本番binding/secret・物理削除・push/PR/merge/deployは行っていない。

## 起動と境界

- Rust 1.94.1、worker/worker-build 0.8.7、Wrangler 4.152.0。Cargo.lock/package-lockを固定。独立workspaceは担当内だけで定義
- 通常buildは本人・運営・fake配達を無効にして501。開発機能は`local-development`と`LOCAL_AUTH=true`の両方が必要。本番有効化なし
- `entry.mjs`のnamed entrypoint `LtOperator`へservice bindingを設定し、`binding.operate(context, request)`を呼ぶ。管理adapterの`fetch(request, context)`から変換する。contextは検証済み`{actorId,role,requestId}`。Rustがroleから通常運営可否を導出
- 公開fetchには運営routeを登録しない。LtOperator.fetchも404。actor/role/context headerを公衆URLへ付けても操作不可。proxyは毎回最新の在籍・役割を検証し、ブラウザー由来contextを破棄する必要がある
- JSはnative Request/context/envをRustへ渡すだけ。JSON本文はRustがchunkごとに64KiB上限を確認して一度だけ解析。TSで業務処理後にRustで再解析する境界はない
- `tests/proxy.*`は別ポートの固定架空assistantによる試験ハーネス。実管理proxyのセッション/在籍/役割認証を証明しない。実proxy結合は未実施

## route表

本人・運営の実装済みrouteも開発限定。公開JSONは具体型で検証し、private項目/型不正/必須欠落は非公開。実HTTPのJSON応答は共有Schemaでも検証する。

| Method | Path | Response | 状態 |
| --- | --- | --- | --- |
| GET | `/api/lt/v1/events` | `PublicEventPage` | 実装 |
| GET | `/api/lt/v1/events/:eventId` | `PublicEvent` | 実装 |
| GET | `/api/lt/v1/events/:eventId/talks/:talkId` | `PublicTalk` | 実装 |
| POST | `/api/lt/v1/auth/email` | `EmailAccepted` | 実装 |
| GET | `/auth/verify` | `ApplicantSession` | 確認HTML・GET非消費 |
| POST | `/api/lt/v1/auth/verify` | `ApplicantSession` | 実装 |
| POST | `/api/lt/v1/auth/logout` | `EmptyResponse` | 実装 |
| GET | `/api/lt/v1/applications` | `ApplicationPage` | 実装 |
| POST | `/api/lt/v1/applications` | `Application` | 実装 |
| GET | `/api/lt/v1/applications/:id` | `Application` | 実装 |
| PATCH | `/api/lt/v1/applications/:id` | `Application` | 実装 |
| POST | `/api/lt/v1/applications/:id/resubmit` | `Application` | 実装 |
| POST | `/api/lt/v1/applications/:id/withdraw` | `Application` | 実装 |
| POST | `/api/lt/v1/applications/:id/request-withdrawal` | `Application` | 実装 |
| POST | `/api/lt/v1/applications/:id/cancel-withdrawal` | `Application` | 実装 |
| GET | `/api/lt/v1/operator/events` | `EventSettingsPage` | 内部RPC実装 |
| POST | `/api/lt/v1/operator/events` | `EventSettings` | 内部RPC実装 |
| PATCH | `/api/lt/v1/operator/events/:id` | `EventSettings` | 内部RPC実装 |
| POST | `/api/lt/v1/operator/events/:id/copy` | `EventSettings` | 内部RPC実装 |
| POST | `/api/lt/v1/operator/events/:id/cancel` | `EventSettings` | 内部RPC実装 |
| GET | `/api/lt/v1/operator/events/:id/applications` | `OperatorApplicationPage` | 内部RPC実装 |
| PUT | `/api/lt/v1/operator/events/:id/timetable` | `OperatorTimetable` | 内部RPC実装 |
| POST | `/api/lt/v1/operator/applications/:id/approve` | `OperatorApplication` | 内部RPC実装 |
| POST | `/api/lt/v1/operator/applications/:id/return` | `OperatorApplication` | 内部RPC実装 |
| POST | `/api/lt/v1/operator/applications/:id/reapprove` | `OperatorApplication` | 内部RPC実装 |
| POST | `/api/lt/v1/operator/applications/:id/hold` | `OperatorApplication` | 内部RPC実装 |
| POST | `/api/lt/v1/operator/applications/:id/reject` | `OperatorApplication` | 内部RPC実装 |
| POST | `/api/lt/v1/operator/applications/:id/confirm-withdrawal` | `OperatorApplication` | 内部RPC実装 |
| POST | `/api/lt/v1/operator/applications/:id/email-change/investigate` | `EmailChangeRequest` | 未対応（次の分割実装） |
| POST | `/api/lt/v1/operator/applications/:id/email-change/send-verification` | `EmailChangeRequest` | 未対応（次の分割実装） |
| POST | `/api/lt/v1/operator/applications/:id/email-change/confirm` | `EmailChangeRequest` | 未対応（次の分割実装） |
| GET | `/api/lt/v1/auth/session` | `SessionStatus` | 実装 |
| GET | `/api/lt/v1/operator/events/:id` | `EventSettings` | 内部RPC実装 |
| GET | `/api/lt/v1/operator/events/:id/timetable` | `OperatorTimetable` | 内部RPC実装 |
| GET | `/api/lt/v1/operator/applications/:id` | `OperatorApplication` | 内部RPC実装 |

例外メール変更はassistantを403、admin/executiveも未対応501とし、任意上書きを実装していない。共有追補のNOT_IMPLEMENTED/SERVICE_UNAVAILABLEを取り込み、未対応操作は型付き501を返す。GET /auth/verifyはrepresentation=htmlに従う確認HTMLであり、sessionはPOSTだけが発行する（共有routeのresponse名ApplicantSessionは親側の整理事項）。契約にDELETE/start/endの専用routeはないため追加していない。

## 業務と競合

確認linkはWebCrypto乱数256bit、SHA-256のみ保存、login purpose、1時間。GETは消費せずURLからtokenを除去、POST単一条件付きUPDATEで消費とsession発行を原子的に処理。cookieはhost-only `__Host-`、HttpOnly/Secure/SameSite=Strict。sessionはユーザー確定の24時間固定。変更操作は厳密Origin、X-LT-CSRF:1、JSONを要求。fake確認linkは試験専用buildの別ポートからのみ取得し、公開のtest bypassなし。

本人DTOは具体型で再構築し運営メモを含めない。所有者、固定保持期限、version、状態を検証。受付期間・親状態・満枠・資料URL・入力を提出時に再検証し、同一本人/回の有効申請はunique制約。終端申請は戻さず、受付内なら別IDで新規提出できる。

初回承認はapplication/event/schedule version、時間枠、容量を単一UPDATEで照合。勝者triggerだけが枠、承認receipt、公開版、時間割、outbox、auditを生成する。D1のUPDATE 0行がbatch後続を止めないことを前提に、後続変更は勝者op/version/hashに従属。辞退batchは内部の試行nonceも照合し、既存の同じopのreceiptを新しいUPDATEの勝者として扱わない。保留・見送り・差し戻し・再承認・辞退確定もreceiptとversionを検証し、運営メモを再取得/再送/保留後の承認結果で維持。同一operationIdの同時再送は競合後に勝者receiptを読むだけで同じ結果を返し、更新を再実行しない。

時間割は全予約発表を一度ずつ含み、各発表直後の入替（最後/休憩/閉会前を含む）、共通時間、連続時刻、開会先頭/閉会末尾を検証。0分入替は0長block。終了は全block末尾から計算。本文承認版を時刻保存で上書きしない。本文操作のSQLは保存直前の公開時刻を合成するため、古いDTO読取後の時間割保存とも競合安全。再承認で枠を二重計上しない。

辞退確定は枠を解放し公開登壇中止記録を残す。開催前は発表+直後入替を除き、後続の発表/入替/休憩/閉会すべてを同じ差分だけ繰上げる。開催開始後は予定を維持し、その後の時間割保存も中止発表の予定時刻を保つ。依頼取消と確定は同じapplication versionを競合させる。

全体中止はevent versionを条件に受付と公開一覧/detail/talkを停止し、有効申請だけにeventCancelledを一度ずつ生成。同一op再送は既存結果、旧version/別op再中止は409で通知を増やさない。個別のreviewを全体中止状態に書き換えず、親stateで公開を遮断する。

運営一覧は`review`/`withdrawal`で絞り、受付時刻+IDの昇順。`limit`は1〜100（省略50）、`cursor`は前ページ最後のID。期限後は一覧・詳細・変更・operation再送から取得不可。本人/運営DTOのprivate canaryも検証する。

## コピーと未定の提案

コピーするのは会場・持ち時間・入替・枠上限の4項目だけ。申請、公開本文、token/session、元stateは複製しない。コピー回は内部publish_enabled=0で必ず非公開・募集不可。提案日時が来ても開かず、運営が受付日時を変更して設定を保存するまで有効化しない。公開/募集と事業状態を分離しているため、EventSettings.stateはscheduledでも公開とは限らない（publishEnabledで判定する）。

EmptyMutationには新タイトル/日時の欄がないため、独立した開発提案値としてタイトルLT会、案内空、UTC、観測時刻の30日後開始、7日前募集開始/1時間前締切を使う。自動公開はしない。日時を確定する操作では他回の半開募集期間との重複をDBで拒否し、同時募集1回を守る。

枠上限は予約数未満に減らせない。承認/時間割がある共通時間や開始日時の変更は不整合を避けて409。初回承認は時間割末尾へ連続追加し、末尾が閉会なら先に時間割を編集する。任意途中挿入の自動再配置は未実装。時間割未作成の終了日時は枠上限×（発表+入替）の開発上の仮計算で、保存後は全block末尾に置換する。

開始後判定は開始日時と格納stateを使用する。公開/本人/内部運営APIとfake配送の処理前にRustでreconcileし、scheduled→started→endedを条件付きUPDATEする。本番cronは未設定。終了は時間割の最後の入替/休憩/閉会blockまで含む。空の時間割は長さ0として予定開始時刻にendedとなる。publishEnabled=falseのコピーは自動開始/終了させない。終了確定時にended_atを予定終了時刻で固定し、遅れた観測/時刻訂正/再送で状態や期限を延ばさない。中止は優先し、cancelled_atを一度だけ固定する。保持期限は固定した終了/中止時刻をAsia/Tokyoで3暦月進め、該当日がなければ月末へ補正する。

## outbox・保持

7種類の業務通知と別枠の確認linkをfake adapterだけで扱う。fake配達receiptとoutbox状態を同じbatchで確定し二重配達を抑制。期限後は配達しない。実SMTP/API送信のexactly-onceを保証する実装ではない。再発行時の旧確認linkを失効させるか等は未定。

非公開データは終了/中止の初回確定からUTC暦3か月を固定提案とし、申請、本人/運営operation receipt、承認receipt、audit、outbox、fake配達、設定と時間割receiptへ継承。token/session/fake確認mailは自身の短期期限。編集/再承認で固定期限を延長しない。公開archiveは独立snapshotと公開承認証跡を使い、私有期限後も維持する（全体中止は非公開）。月末丸め/保持起点/timeZoneの最終決定は未定。既存架空回の不明な終了時刻は導入観測時刻という明記した提案で補完。

`retention-dry-run.sql`は件数SELECTのみで、公開archiveを対象にしない。物理行は残るがAPI取得/再送/配達を期限で拒否する。削除実行や本番cronは存在しない。期限未設定outboxは別件数で報告し、推測削除しない。

## 再現と検証

サービスディレクトリで実行。JSON Schema試験依存は共有`contracts/lt/requirements-test.txt`のjsonschema==4.26.0（必要ならプロジェクトvenvへ入れる）。Node/PMのPC全体設定は変更しない。

```powershell
npm ci
cargo install worker-build --version 0.8.7 --locked --root .tools
.tools/bin/worker-build --release . --features local-development,runtime-tests
$env:WRANGLER_LOG_PATH = Join-Path $PWD '.wrangler/logs'
$env:WRANGLER_SEND_METRICS = 'false'
node node_modules/wrangler/bin/wrangler.js d1 migrations apply lt-local --local
node node_modules/wrangler/bin/wrangler.js d1 execute lt-local --local --file tests/fixture.sql
node node_modules/wrangler/bin/wrangler.js dev --local --port 8787 --ip 127.0.0.1
```

別terminal:

```powershell
node node_modules/wrangler/bin/wrangler.js dev --config tests/proxy.toml --local --port 8788 --ip 127.0.0.1
python tests/run_runtime.py
cargo check --locked --offline
cargo test --locked --offline --features local-development,runtime-tests
cargo fmt --check
python tests/prepare_fresh.py
```

fixtureは空のローカルDBに一度投入。prepare_freshは毎回新しいworkspace内persist先を作り、既存DBを削除せず全migrationとfixtureを確認する。確認linkはtest側が別ポートのfake-mail受取口から取得し、CLIのJSON出力には出さない。material URLの自動fetchはしない。

全47件のactual local Worker+D1+named RPC試験を実施。公開漏洩/IDOR/token replay/Origin/既知長とchunked本文上限/重複申請/最後1枠同時承認/敗者副作用ゼロ/二重通知/期限/保持archive/状態遷移/募集重複/時間割/辞退取消競合/全体中止競合を確認。JSON成功応答と契約エラーを共有Schemaで検証する。新規8運営ケースと異種操作raceを含む。ログはgit対象外のtest-results.txt。

異種操作raceは`runtime-tests`だけにある読取後700ms遅延と観測headerを使い、旧DTO読取→並行時間割保存完了→旧読取元の再承認/本人編集/再提出書込という順序を実証。認証や所有者検証は省略しない。通常buildにはこのmodule/遅延/headerが存在しないことをbundleでも確認。通常開発に戻す場合はruntime-testsを外してbuildする。

競合試験内のHTTP送信は並列のまま。管理CLIやbuildをその最中に併走させず、試験ファイル間だけ直列化する。途中のD1 commit-token一時エラー、compound SELECT上限、保持列更新のversion guard誤発火、初回承認と既存公開版合成の分離漏れは切り分け・修正し再試験。最終失敗/未実施はverification.jsonと最終報告に記す。実管理proxy認証、スマホ/PC/キーボードの実UI結合、クラウド試験は未実施。

## 資源の目安

bundleの非圧縮/gzipとlocal GET wall timeはverification.json。測定スクリプトはtests/measure_bundle.py、tests/benchmark_local.py。wall timeはCPU時間ではない。クラウドCPU/起動時間/実トラフィック/D1 quotaは未検証で、無料枠適合を保証しない。有料サービスや本番リソースは追加していない。

2026-10-25に確認した[Cloudflare公式limits](https://developers.cloudflare.com/workers/platform/limits/)ではFree HTTP CPUは10ms、100,000 requests/day、bundleは非圧縮64MiB。gzipは参考値のみ。ローカル測定で本番CPUや料金を推測保証しない。

公式参照: [Rust Worker](https://developers.cloudflare.com/workers/languages/rust/)、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[service binding RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)。共有contractsは親指定追補を取り込んだだけで独自変更していない。


検証上のログ問題: 初期ハーネスがD1管理CLIでfake確認URLを取得したため、Wranglerの共有ログに架空tokenのURLが残ることを確認。現在はruntime-tests専用exportと127.0.0.1:8788のPOST /test/fake-mailで受け取り、URL/tokenを出力しない。通常buildには受取exportがなく、公開fetchにtest routeはない。実メール/本番情報は含まれない。既存共有ログは他作業との共有・物理削除範囲外のため変更していない。


状態追補: Application/OperatorApplicationのeventState/eventCancelledAtとEventSettings.publishEnabledを全GET/list/mutation/replayで現在の親行から合成する。receiptの本文/versionは元操作の結果を維持するが、親状態と保持期限は毎回最新を優先する。ログインsessionは確定方針どおり24時間固定。確認linkは1時間、再発行は同一メールの未使用login tokenだけを同じD1 batchで失効させ、既存sessionは維持する。

runtime-testsとlocal-developmentを両方指定した検証bundleだけが固定時計を持つ。test proxyのPOST /test/clockは内部RPC専用で、公開fetchには登録しない。通常bundleにはset_clock/fake_mail exportも停止hookも含めず、固定時計が残っていれば実時刻へ戻してから処理する。これらは本番認証の代替ではない。

保管担当との境界: retention-dry-run.sqlはSELECTのみ。全体中止のlt_public_events/lt_public_talksも期限到達後の削除候補件数に含める。通常終了の公開archiveは含めない。物理削除の別担当はevent.id/private_expires/stateとapplication.event_idを境界として独立SQLを作成できるが、API側の番号付きmigrationと接続は本担当が統合する。lt_auth_tokens/lt_fake_mail/lt_auth_rateは開催回所属ではなく、独立した自身の期限切れ整理とする。メール一致で別開催分のsession/tokenを削除しない。新しいメール変更tableは未作成で、接続前に所属一覧を追加する。


状態追補の検証中に解決した問題: 初回のD1 CLIがfixture準備で終了コード1となったためstderrを捕捉するように修正し、同じHTTP並列試験を再実行。新しい時計試験の後処理は蓄積fixtureを1件ずつCLI復元して遅くなったため、自分のテストPythonだけを停止し、保存済みログの元設定を一括復元した。現在はSQLファイルを使う一括後処理でWindowsのcommand長上限も避ける。HTTPの競合試験は並列のまま。中止旧公開情報のdry-run追加で古い「publicという文字が一切ない」というテスト前提を修正し、通常archive除外/実データ不変を検証する。


メール接続（0027〜0029）: [mail-connection-plan.md](mail-connection-plan.md)に接続/排他/期限を記載する。新しい認証outboxと共通配送engineを使用し、旧fake配送は独立動作しない。DBのmodeは既定disabledで、runtime試験だけがfakeへ明示変更する。Envelope秒とAPIミリ秒をfloor変換し、各APIのreconcileで期限切れの確認URL/job payloadを論理消去する。物理削除・本番有効化・外部送信は行っていない。保管担当向けの所属と単位はmail-retention-boundary.jsonを参照。
