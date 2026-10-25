# ローカル統合検証

統合branch: feature/koto/LtIntegrationPart1。元dirty checkoutと各担当worktreeは編集しない。

## 分離

Worker名はlt-integration-public-local、D1 ID末尾000006、public:18877、既存API試験proxy:18878、実proxy検証bridge:18879。全て127.0.0.1限定。Wrangler設定はローカル専用で本番配備しない。同じ名前を使う他タスクとregistryが干渉するため分離した。公開gateをCLIで未来へ更新しHTTP一覧/詳細が拒否する2テストによりDB一致を確認。

## 実管理境界

apps/admin-web/tests/lt-binding-integration.test.mjs は既存role-fixtureの実authモジュールと署名Cookie、在籍/roleのDB再検証、実proxyLtCoreを使用し、tests/integration-bridgeのnamed servicebindingからRustへ接続する。匿名401、外部Origin403、role剥奪、在籍失効、偽造header、未接続503、メール例外403、成功GETと作成mutationを検証。GitHub外部OAuth通信は行わず架空の認証済み主体のみ。bridgeはテスト専用でHTTP contextを受け取るため本番へ配備してはいけない。匿名固定assistantの既存API試験proxyは別用途で、実管理認証の証明には使わない。

## 状態追従

本人はeventState=cancelledで中止表示し全mutation操作を非表示にする。copyのpublishEnabled=falseを運営へ明示。最終認可はAPIが行う。backendの新必須field追従まではschemaを緩めず、全API回帰/全UI縦断の最終合格は保留する。

## 検証記録

共有契約6件、公開unit22件、公開check/tsc/build、管理41回帰/tsc/lint/build、Rust check/test/fmt・開発bundleが成功。公開Chrome既存3件成功。開催中止の再取得を含むChrome E2E4件、公開gate2件+公開API6件、実proxy結合1件（成功mutationと匿名/失効/role剥奪/Origin/偽造header/503含む）が成功。最終treeでの全API再検証・自動開始終了・本人/運営fieldの実backend接続は未完了。実メール・本番SQL・本番binding・役割変更・削除有効化は行わない。


## 状態追補統合の区切り

API 8b6ca03/設計47f66abを統合。状態追補後の12suite/41 actual Worker+D1+RPC、管理routeを含む44回帰、共有6、公開unit22が成功。固定応答を使わないe2e-live/journey.spec.tsも成功。署名Cookieの架空運営主体から実route・named binding・Rustへ接続し、確認→申請→承認公開→差し戻し→編集再提出→再承認→時間割→辞退確定→画面内二段階中止→本人親状態の再取得まで検証。PC/390px確認。外部GitHubOAuth通信はfixture、メールはfakeのみ。

ブラウザーと同時にD1 CLIでcleanupを走らせる検証側待機を避け、liveテストは専用架空DBを使う。実行前に既存fixtureの募集期間を閉じ、新規fixture開催を作る。前データを保持する運用DBには絶対に実行しない。公開UIサーバーはe2e/live-server.mjs（18880）、管理UIはtests/lt-route-browser/server.mjs（18920）、binding bridgeは18879。live-serverは同一originだけを受け入れ、検証用のAPP_ORIGINへ変換するローカル専用facade。本番接続設定ではない。

実API接続で判明したフォームの空任意文字列を省略する修正を実施。Schemaを弱めて通していない。メール変更・mail接続・D1 retentionは後続の独立区切り。
