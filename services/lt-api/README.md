# LT API ローカル実装

本番有効化・実メール・本番SQL・push/deployは行わない。共有契約追補7c0e93dはcd2fd50として取込済み。追加エラーenumの変更は親で承認確認中のため未実施。

## 実装済み

- 公開 events 一覧/detail/talk。時間割は PublicEvent.schedule。全経路で親状態と募集開始時刻(public_opens_at)を確認。全体中止・非公開・開始前は404/一覧除外。no-store
- 公開 DTO の具体型、未知キー・必須欠落・object/null混入・不正UTC時刻・空文字列を拒否。不正 snapshot は非公開
- 公開talkは承認証跡必須。INSERT/UPDATE triggerで承認済み申請の公開版との一致を検証。出所未確認の旧snapshotは公開しない。時間割の未承認talk参照も公開しない
- 開発限定 email request、GET確認の非消費/URL除去、POST一回交換、session GET/logout。WebCrypto乱数256bit、SHA-256保存、login purpose/1時間期限。session24時間は1〜24時間に設定可能な開発提案値で本番無効
- host-only __Host- cookie、HttpOnly/Secure/SameSite=Strict。変更操作は厳密Origin/非simple CSRF header/JSONを要求。fake mailの確認リンクはローカルD1管理CLIからのみ取得し、公開test bypassなし
- 本人申請一覧/detail/提出/許可状態編集/再提出/初回承認前辞退/承認後辞退依頼と取消。所有者/version/入力/受付期間/満枠/私有保持期限を検証。有効申請の同一メール・開催回unique制約
- 内部運営の申請detail、時間割GET、初回承認、差し戻し、保留、拒否、再承認。3役割を通常運営可としてRustで導出。メール変更は本人確認手順未確定のため未対応
- 初回承認はapplication/event/schedule versionと時間重複/開催範囲/容量を条件にする単一UPDATE。勝者triggerだけが枠・承認receipt・公開snapshot・時間割・outbox・auditを生成。UPDATE 0件で後続副作用なし
- 差し戻し中は旧承認版保持。再承認は本文だけ切替え、枠と確定時刻を維持。operation receiptで再送を検証
- outboxはsubmitted/approved/returned/reapproved/rejectedを生成。fake配達receiptで二重配達抑制。実送信なし。retention-dry-run.sqlはSELECTのみ、公開アーカイブを対象に含めない

## 内部接続契約

entry.mjsの named entrypoint `LtOperator` をサービスbindingに指定し、`binding.operate(context, request)` を呼ぶ。contextは共有OperatorContext `{actorId, role, requestId}`。管理adapter `fetch(request, context)` はこのRPCへ変換可能。JSON本文はJSで解析せずRustで1回だけ解析する。

公開fetchにoperator routeを登録しない。LtOperator.fetchは404。公衆URLへ偽造actor header/context headerを付けても操作不可。RPC bindingを持つ検証済みproxyだけがcontextを渡す。proxyは毎回最新在籍・役割を検証し、ブラウザー由来contextを破棄する。本番binding/secretは追加していない。

tests/proxy.tomlとproxy.mjsはローカル試験専用で、固定の架空assistant contextを作る。実際の管理認証proxyの代替として配備しない。試験用 `/test/dispatch-fake` もこの別ポートだけ。通常buildと開発設定不一致時は本人/運営/fake配達を有効化しない。

## 再現

Rust 1.94.1、worker/worker-build 0.8.7、Wrangler 4.152.0。依存lockはコミット済み。PC全体のNode/PM設定は変更しない。

```
npm ci
cargo install worker-build --version 0.8.7 --locked --root .tools
.tools/bin/worker-build --release . --features local-development
node node_modules/wrangler/bin/wrangler.js d1 migrations apply lt-local --local
node node_modules/wrangler/bin/wrangler.js d1 execute lt-local --local --file tests/fixture.sql
node node_modules/wrangler/bin/wrangler.js dev --local --port 8787 --ip 127.0.0.1
```

別terminalで:

```
node node_modules/wrangler/bin/wrangler.js dev --config tests/proxy.toml --local --port 8788 --ip 127.0.0.1
python tests/public_guard_test.py -v
python tests/runtime_test.py -v
python tests/applicant_runtime_test.py -v
python tests/operator_runtime_test.py -v
python tests/review_runtime_test.py -v
python tests/maintenance_runtime_test.py -v
cargo check --locked --offline
cargo test --locked --offline --features local-development
cargo fmt --check
```

fixtureは全migration適用後の空のローカルDBに一度投入する。fixture自体は公開開催回のみ。承認済みsnapshotは統合テストが申請→内部承認を通して作る。再試験は別のpersist-toを使い、既存DBを削除しない。

## 検証と残課題

actual local Worker+D1+named service RPCで公開6、公開ガード2、本人4、運営3、再承認1、maintenance2の計18テストを実施。Rustの型検査・単体1・最適化Wasm buildも実施。通常sandboxのローカルHTTPはWinError10013で失敗し、正式昇格で同一ローカル試験を実行して成功。Rust整形の初回差分は修正済み。

未実装は成功扱いにしない。辞退確定（開始前の後続繰上げ/開始後維持）、時間割PUT、開催設定CRUD/copy/cancel、運営一覧/開催detail、例外メール変更は501。全体中止を公開側で隠す条件は実装済みだが、中止mutation/通知は未実装。field error詳細と統一501 JSONは共有契約の追補待ち。既存公開scheduleの編集や終了後の固定保持期限設定も未実装。

保持dry-runは申請/token/fake mail/outboxの期限付き件数のみ。audit/receipt/fake配達を含む全私有データの固定期限設定・dry-run集計は未完了。期限未設定outboxは別件数で報告し、推測削除しない。本番削除なし。UIブラウザーのcookie/キーボード/スマホ/PC結合は未実施。

CPUの精密計測・クラウド試験なし。ローカル壁時計はCPU時間ではなく、無料枠適合は未保証。bundleサイズは検証記録参照。本人機能のメール正規化は小文字化、レート制限はメールhashごと5回/時間の開発提案で、全体濫用制御は本番前に追加検討が必要。

公式資料: https://developers.cloudflare.com/workers/languages/rust/ 、https://developers.cloudflare.com/d1/worker-api/d1-database/ 、https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/ 。worker-rs RPCは公式rpc-server例と固定worker-buildの生成コードを確認して採用。

## 保持・DTOレビュー対応（追加）

終了/中止の初回確定からUTC暦3か月を固定提案値として設定し、申請、承認receipt、本人/運営operation receipt、audit、outbox、fake配達に継承する（0009/0010）。本人/運営の詳細・変更・再送は、receipt自身だけでなく現行申請の期限も再照合する。申請一覧も期限後を除外。確認token/session/fakeメールは自身の短期期限を使用する。削除処理は依然存在せず、dry-runのみ。保持開始時点・暦月・UTCの採用は仕様未定に対する安全な提案。

本人DTOは具体型で許可項目を再構成し、rootのoperatorNoteやnested content/speakerの誤混入を返さない。運営noteは保存列から読み、operation再送でも保存結果を保持する。公開した終了済み回は差し戻し→本人訂正→再承認が可能で、公開アーカイブと最初の固定保持期限を維持する。

追加テスト: privacy_runtime_test.py（期限後のdetail/list/replay拒否、private canary、運営メモ保持）。全runtime試験はtests/run_runtime.pyで直列実行し、test-results.txtへログ保存する。固定assistantのproxyハーネスはRust内部境界の試験であり、実管理proxyのセッション/在籍/役割認証を証明しない。実proxyとの結合検証は未実施。

検証中、並行したローカルDB準備・試験で一度D1_ERROR「Failed to get session commit token」による500が発生した。API側に盲目的な再試行は追加していない。独立したDB準備完了後に直列回帰を再実施する。通常sandboxのsocket制限とは別のlocal runtimeエラーとして記録する。

開催設定CRUD/copy、時間割PUT、辞退確定と繰上げ、全体中止mutation/outboxは引き続き未実装。今回の追加変更で成功扱いにはしていない。保持dry-runの対象はaudit/receipt/fake配達/auth rateにも拡張済み。

最終直列回帰: tests/run_runtime.py の7ファイル、全19件PASS。最終ログはローカルtest-results.txt（生成物、git対象外）。dry-runのcompound SELECT上限は独立SELECTへ分割して解消し、maintenance試験PASS。commit-tokenエラーは最後の単一直列実行では再現しなかった。別の空ローカルDBへ0001〜0010を適用してfixture投入成功、その後0011の適用も成功。0011は導入前の終了時刻が不明な架空回に限り、導入観測時刻を保持開始提案とする。既存のdirty checkout・本番DBには適用していない。

## 開催設定・時間割（最新の実装状況）

内部RPCのGET events一覧/detail、POST create/copy、PATCH settings、GET/PUT timetableを追加。共有契約にDELETEルートはないため削除endpointは追加していない。開催設定は具体型で未知キー/不正UTC/IANA timezone/受付順序/数値を検証し、受付期間は半開区間で重複をDB triggerで拒否する。同時作成も1件だけが成功する。枠上限は予約数未満に減らせず、承認または既存時間割がある場合の開始/共通時間変更は不整合を避けて409で拒否する。

コピーは会場・持ち時間・入替・枠上限だけ。申請/公開本文/token/session/元状態はコピーしない。EmptyMutationには新しいタイトル・日時の入力欄がないため、独立した開発提案値としてタイトルLT会、案内空、UTC、作成観測から30日後開始、開始7日前募集開始/1時間前締切、scheduledを採用。これは確定仕様ではなく、本番無効のまま。重複する場合はコピーも409。将来この初期値を確定するには親側で仕様確認が必要。

時間割はevent/schedule versionを同じUPDATEで検証し、勝者triggerだけが反映する。全予約発表を1回ずつ含め、共通持ち時間、連続した時刻、重複IDなし、開会先頭/閉会末尾、各発表直後の入替（最後・休憩・閉会前を含む）を検証。入替0分は0長blockとして保持。終了日時は最後のblockから計算する。設定変更だけで既存時間割の終了日時を巻き戻さない。公開本文は承認版を維持し、公開時刻だけ更新。再承認は最新の確定時刻を使う。新規承認にも入替blockを原子的に生成する。

初回承認の時刻は現在の時間割末尾に連続して割り当てる安全な実装とし、末尾が閉会の場合は先に時間割を編集してから承認する。任意の途中挿入を自動再配置する処理は未実装。

新しい設定・時間割operation receiptと設定のactor情報も固定保持期限を継承し、dry-run集計対象。期限だけの更新には業務version guard/副作用を発火させない。検証中にこのguardの誤発火を発見して0017/0018で修正した。共有契約・既存管理アプリ・他担当worktreeは変更していない。

追加統合テスト3件: 設定create/list/detail/update/copy、連続PUT/version競合/未知項目・不正時刻・null、募集重複の同時HTTP作成、2枠への連続承認と必須入替・容量制約、再承認時刻保持。全試験は旧19＋新3の22件。race試験はHTTPクライアントを並列送信し、その最中にD1管理CLIを走らせない。ハーネスの試験ファイル間の直列化でrace自体を消していない。

fresh-final-settingsの新しい空ローカルDBへ修正済み0001〜0018 migrationと架空fixtureの適用成功。実管理proxy認証を含む結合、CPU精密計測、クラウド試験は未実施。残りは辞退確定と繰上げ、全体中止mutation/outbox、運営applications一覧、例外メール変更。本番binding/実メール/削除/push/deployなし。

この区切りの最終結果: tests/run_runtime.py 全22件PASS。並列HTTPの同時募集作成は1成功/1競合、最後1枠同時承認も1成功/1競合で敗者副作用ゼロ。最終実行中にD1 commit-tokenエラーは発生しなかった。cargo check/test/fmtと最適化bundle成功。Wasm 903045 bytes、JS 24208 bytes（非圧縮、CPU/無料枠保証ではない）。時間割未作成時の終了時刻は枠上限×（発表＋入替）の仮計算であり、作成後は実際の全block末尾に置換する開発提案。提案初期値は本番有効化していない。
