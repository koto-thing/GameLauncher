# LT mail transport / retry

独立branch feature/koto/LtMailPart1。API本体・番号付きmigration・本番設定は変更しない。実メールは送っていない。

## 接続API

API Cargo.toml に `lt-mail = { path = "../lt-mail", features = ["worker-runtime"] }` を追加し、内部schedulerから `runtime::enqueue(&db,&Envelope)` と `runtime::dispatch_one(&db,&Transport,unique_attempt_id)` を呼ぶ。提案SQL `proposals/outbox-dispatch.sql` の番号はAPI担当が決める。D1は同じworker 0.8.7。wasm32 targetでcheckする。

Envelope = {id,recipient,kind,expires,action_url}。expiresはepoch秒（既存outboxはミリ秒）。idは既存outbox idと同一。宛先・kindは元outboxに一致しなければ投入不可。jobの配達有効期間は最大24時間という暫定実装上限。確認リンクは1時間以下。保持期限が先ならそちらを優先。未確定保持期限は無期限配達を意味せず、APIが短い配達期限を指定する。確認メールもAPI担当がpurpose付き確認tokenと同じtransactionでoutboxへ投入する必要がある。現在のlt_fake_mailをこのcrateが勝手に読み取ることはない。

TransportはDisabled/Fake(Outcome)/Http{endpoint,bearer}の排他enum。DB lt_mail_modeも一致しないとclaim不可。既定disabled。**既存fake_dispatchもAPI担当がこのmodeを必ず検査して排他化すること**。接続前に旧fake_dispatchと新dispatcherを並行起動しない。資格情報の生成・設定・参照は行っていない。秘密はruntime設定から内部だけで渡す。公開HTTP経路やブラウザーからtransport/contextを指定させない。

claimは単一UPDATE RETURNING。attempt fenceの一致だけが結果を確定し、元outboxのsentも同じfenceに従属。Temporaryのみ指数backoff（最大5試行）。Permanentは停止。通信切断/未知応答/中断leaseはUncertainで隔離し、自動再送しない。外部配達のexactly-onceは保証しない。結果不明の手動確認・再送方針は運用判断。返却は件数のみでrecipient/link/token/外部本文をログに出さない。

## 既存費用内の経路比較（2026-10-25公式資料確認）

- WorkersはTCP+TLSに対応し、25番は既定で不可。SMTP465を直結する技術経路はあるが、SMTP対話・認証・MIME・状態管理の追加実装が必要。Rust常駐サーバーは仮定しない。
- ロリポップはエコノミーでPHP CGIを提供。HTTPS → PHP → 既存sendmailという中継なら既存環境で実装可能。今回はRust HTTP transportとPHP候補をコード化。実契約のPHPバージョン・mail()可否・Fromの許可・送信上限残量・HTTPSを本番接続前に確認する。
- エコノミー上限は契約全体100/h・1000/day。中継は保守的に80/h・800/dayに予約制限するが、他アプリの送信量も合算されるため運用調整が必要。無料の別サービスや契約アップグレードを追加しない。

公式: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/ 、https://lolipop.jp/manual/hp/cgi/ 、https://lolipop.jp/terms/prohibition/ 、https://lolipop.jp/manual/mail/mail-set/

## PHP中継候補

relay/relay.phpは設定未指定/disabledなら送信不能。config.example.phpは空値だけ。設定ファイルとprivate_dirはWeb公開領域外、HTTPSを必須とする。32文字以上の別途承認済みbearerをhash_equalsで検証し、From/Reply-To/subject/bodyテンプレートを固定。任意本文/任意ヘッダー/他originへのリンクを受け付けない。確認リンクは許可originの/auth/verify、通知は/applicationsだけ。認証を通った信頼済みWorkerだけが代表者宛先を渡す。公開ブラウザーからのCORSや匿名送信を許可しない。

flock付きprivate receiptで同じidを二重送信しない。mail()呼出前にuncertain記録を置き、クラッシュ/送信成否不明は自動再送しない。リンクや宛先をreceiptに保存せず、hash/state/expiresだけ。private_dirの期限切れreceiptは保持削除対象だが、削除コード/有効化は今回しない。relayも設定ファイルもアップロードしない。

**未検証**: PHP候補は8.1以上を要する。PHP実行環境がこのタスクPATHにないためPHP構文/実行試験、実際のHTTPS/メール送信、D1+Worker上のdispatcher縦断は未完了。fake試験だけで実送信完成と扱わない。API担当によるSQL接続・期限削除・設定排他・scheduler接続が必要。新機能を本番有効化する設定は含まない。

## 検証

cargo test --locked --offline、cargo check --locked --offline --target wasm32-unknown-unknown --features worker-runtime、cargo fmt --check、python -m unittest discover -s tests -v。Rustは成功/一時失敗/恒久失敗/期限/不明/上限、SQLiteは実際にRustが使うclaim SQLの二重実行・mode・期限・fence・保持削除連動を検証する。

最終ローカル検証: Rust unit 6件、SQLite claim/競合 7件、wasm32 worker-runtime check、fmt checkが成功。API本体への接続とPHP実行・実送信は未検証。
