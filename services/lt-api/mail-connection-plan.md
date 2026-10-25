# LT mail 接続（ローカルfakeのみ）

`b8bd297`とPHP安全追補`30c630e`を明示承認後に取り込み、APIと接続した。初回の取り込み拒否は未実行を確認し、新しい承認証拠で通常の承認経路を一度だけ再試行して成功した。別経路での取り込みはしていない。

番号付きmigrationは0027〜0029を使用した。retention担当の0030以降は使用していない。例外メール変更の共有契約・実装はこの接続に含めていない。

- `lt_login_outbox`はlogin token hashに所属し、application IDを持たない。token作成・旧未使用token失効・確認outbox作成を同一D1 batchで行う。確認linkのpurposeはlogin、期限1時間、GETは非消費、POSTだけがsessionを発行する。
- `lt_outbox`は既存の申請業務通知を維持する。created_atを持ち、作成日時不明の既存pending通知は送信期限を短縮して自動再送しない。
- `lt_mail_outbox`は2つの通知源をまとめるDB view。配送IDをapplication:/authentication:で分け、同じ任意operationIdによる衝突を防ぐ。
- `lt_mail_jobs`は単一UPDATEのclaimとattempt fenceで排他化する。旧fake_dispatchは独立処理を削除し、このengineへ集約した。modeの既定はdisabled。fakeとhttpは排他的で、APIはHttp transportを生成せず、HTTP/SMTP送信・秘密取得・設定を一切行わない。
- Envelope.expiresは秒、outboxとprivate_expiresはミリ秒。floor(ms/1000)で期限を延長しない。確認通知は作成+1時間、業務通知は作成+24時間と固定保持期限の短い方。保持期限NULLを無期限送信に読み替えない。
- Temporaryだけ最大5試行までbackoff、Permanentは停止、Uncertain/lease切れは隔離して自動再送しない。外部exactly-onceを保証しない。1回の呼出しは最大50件、login確認の開発fake処理は1件に制限する。
- token再発行/消費/期限短縮で確認URLとjob payloadも短縮・論理消去する。各APIのreconcileで期限到達payloadをscrubするため、scheduler遅延に依存しない。物理削除は行わず、件数確認はretention-dry-run.sqlだけ。
- `lt_fake_mail`と`lt_fake_deliveries`は既存私有行の保持整理用に残るが、新APIは読取/書込しない。互換fallbackはない。test mailboxはfake配送完了済みの新outboxだけを読む。公開fetchにtest routeはなく、通常bundleにfake_mail/test_dispatch/set_clock exportはない。

開発時はlocal-developmentとLOCAL_AUTH=trueが必要。ローカルfake試験だけで`UPDATE lt_mail_mode SET mode='fake' WHERE id=1`を明示実行する。run_runtime.pyは自分のローカルDBに対しこの設定を行う。新DB migration直後はdisabledのまま。実際の本番binding、cron、relay設定、PHPアップロードはしていない。

保管接続点はmail-retention-boundary.jsonを参照。確認通知は開催回のメール一致で削除せず、自身の期限で独立整理する。業務通知はapplication_idから開催回に辿る。jobのsource ID namespaceを考慮し、各source削除triggerでjobも削除される設計だが、今回のruntimeは物理削除しない。

PHPは安全追補を含むソースを保持しただけ。PHP実行環境・relay実行・実送信は未検証。relay側HTTPS/From/送信枠を確認し、別承認するまで本番有効化できない。


検証時のログ修正: 初回の追加試験が認証jobのenvelopeをCLIで全量取得したため、担当フォルダのログ1ファイルに架空確認URL1件が記録された。観測SQLを配送状態だけに変更し、該当する未使用example.invalid tokenだけを失効（または消費済みを維持）した後、担当ログのURLをマスクした。共有ログには触れていない。修正後の追加試験と全47件はURL本文をCLI取得しない。件数はverification.jsonに記録する。
