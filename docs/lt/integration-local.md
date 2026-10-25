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
