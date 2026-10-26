# 無料CPU gate未達時の最小構成案（未実装）

## 変更候補

新サービスや有料プランを追加せず、同じ専用Worker/D1内で、公開GET三経路と既存early gateのみを小さなJavaScript host adapterへ移す。

- `services/lt-api/production-entry.mjs`: 公開GETを `public-read.mjs` へ渡す。本人・運営処理は遅延ロードする既存Rustへ渡す。
- `services/lt-api/public-read.mjs`（新設案）: 一覧・開催詳細・承認済み発表詳細のD1呼出し、公開DTOの厳格な検証と明示的な組み立て、既存エラー/ヘッダーのみを担当する。申請原本をserializeして私有キーを削る方式にはしない。
- `services/lt-api/sql/`（新設案）: 現在 `src/lifecycle.rs` / `src/mail.rs` / `src/lib.rs` 内にある公開読取用SQLとlifecycle/期限payload消去SQLを一つの原本へ切り出す。Rustは `include_str!`、JSはWranglerのText module importで同じSQLを使う。更新は同じD1 atomic batchを維持する。
- `contracts/lt/dto.schema.json` のPublicEvent/Page/Talk定義から公開専用のvalidatorを生成またはコンパイルする。未知キー・型違い・不正日時を拒否し、Rustと同じfixture/canaryを両実装に適用する。validatorの手書き複製を増やさない。新依存が必要な場合は事前に選定・影響を提示する。

公開開始時刻、全体中止、承認markerとarchive整合、募集満枠/締切、終了後closed、空時間割、固定保持anchorを省略しない。Asia/Tokyoの3暦月計算と不延長は既存D1 triggerを使い、JSの日付処理で別実装しない。キャッシュで中止や保持期限を遅らせない。

承認・再承認・差し戻し、枠上限、version/operationId、本人認証、メール変更、outbox/lease、運営認可はRustを維持する。既存管理proxyのGitHub cookie・在籍・role・Origin検証は変更しない。

## 検証と採否

1. 公開fixture・private canary・未知キー/不正日時・募集開始直前/直後・中止直接URL・archive marker・終了後closedを、同じD1データでRustとJSへ適用して比較する。
2. 既存59件、batch途中失敗rollback、時間割対承認の競合を再検証する。公開GETのlifecycle更新も並列mutationと競合させる。
3. 同条件の少量逐次要求でcold/warm、cpuTime/wallTimeを分離して実測する。手動warmupや長いキャッシュでcoldを隠さない。
4. 正常な認証済みmutationも、実管理proxy/既存認証を通して架空対象だけで測る。固定roleの公開proxyを作って代用しない。検証用version選択など、既存管理bindingの本番切替前に計測できる接続手順を親と確定する。新資格情報・権限追加・実メールを計測のために独断で行わない。

公開GETの改善だけで完成としない。Rust mutationに余裕がなければこの案だけでは不足と報告し、さらに言語置換や実行基盤変更を行う前に判断を求める。追加費用0円と公開停止を維持する。
