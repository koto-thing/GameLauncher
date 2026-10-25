# LT 共有契約 v1

基準: origin/master `f0179f2a3242e26e0dd1d81ddb87162e88415a03`。元仕様 Page v0.42 と後続の明示回答に基づく実装契約。既存 dirty ブランチは取り込まない。本段階は契約と検証のみで稼働サービスは追加しない。

## 配置と並列担当

1. 公開・本人 UI: `apps/lt-web/**`。React + Vite Plus。`contracts/lt/v1.ts` と JSON fixture を使用する。
2. Rust Worker: `services/lt-api/**` と LT 専用 migrations。状態遷移、認可、D1、公開 snapshot、時間割、outbox を担当。
3. 管理 UI: `apps/admin-web/app/lt/**` と `app/api/lt/**`。既存 React/Vinext と同一ホスト proxy に統合。

共通変更はまず contracts/lt で合意し、全担当が同じコミットから分岐する。現在の作業ブランチを他担当が同時編集しない。

## 既存コードで確認した認証

最新 master の `apps/admin-web/lib/role-policy.ts` は admin / executive / assistant / null。`roles.ts` は operator_admissions の失効と最新 platform_roles を検証する。`auth.ts` の readSession は最新在籍・役割を検証する。LT 通常操作は3役割、代表メール変更の調査・確認送信・最終確定は admin / executive のみという新契約。既存 DB の役割追加や既存 permissions の拡張は行っていない。

管理 proxy は同一ホストで既存 cookie を検証し、各操作で最新の在籍と役割を再検証する。受信 actor/role/capability ヘッダーは破棄し、ブラウザーが作れない内部サービス呼び出しに認可済み主体を渡す。公開 Worker は operator ルートをマウントせず、管理内部入口は公開 workers.dev/custom domain から到達不可にする。URL 変更だけで管理操作を実行できない構成を受入条件とする。

## ワイヤ形式

`contracts/lt/v1.ts` が共有型、`dto.schema.json` が主要 DTO の厳格な JSON Schema、`routes.json` がルート一覧。Schema は部分的な基盤であり、全 mutation payload の実行時 validator 完成を意味しない。`Mutation.data` は各操作の具体型で追加検証する。HTTP 時刻は UTC RFC3339 ミリ秒3桁 Z、version は1以上の整数、ID は不透明な文字列。開催 timeZone は IANA 名を設定し、Asia/Tokyo は未確定。ページングは items / nextCursor。HTTP status は認証401、権限403、非公開・不存在404、競合409、入力422、期限切れリンク400、頻度429。期限切れ私有データは RETENTION_EXPIRED、存在秘匿が必要な他人のリソースは NOT_FOUND。

公開 DTO は公開 snapshot と公開 Event から許可項目のみ生成する。申請レコードから私有項目を削る実装は禁止。本人 DTO に運営メモ・監査履歴は含めない。キャンセル済み開催回は一覧・詳細・直接URL・API・キャッシュを非公開にし、自動時刻判定で復活させない。

## 状態・原稿・公開版

review / everApproved / slotReserved / withdrawal / published を別管理する。初回承認で枠確保と公開版生成、差し戻しは旧公開版保持、再承認で切替。承認済み履歴のある申請は本人が直接編集・取り下げ不可。運営差し戻し後だけ編集・再提出できる。policy.json の withdraw 元状態一覧は候補であり、必ず everApproved=false を併せて検査する。承認後は辞退依頼を出し、確定前のみ取消可。辞退確定は枠解放・公開発表中止、見送りとは別終端。

初回承認は発表時刻確定が必須。再承認は枠を二重計上しない。差し戻し中・辞退依頼中の枠保持は安全な採用案で、原会話の確定回答とは区別する。終端から旧申請を復活させず、受付中なら別 ID で新申請可。有効メール×開催回は1件。同時募集1回、募集期間の重複拒否、承認数のみ枠計上、満枠停止、締切前だけ空枠で再開。保留の正式受付順を優先し、編集・再提出で順序を変えない。20件は想定規模で件数制限ではない。

## D1 競合と SQL 実装契約

D1 batch の条件付き UPDATE が0行でも後続 statement は自動中断されない。アプリで後から changes を見るだけでは部分成功を防げない。

各 mutation は expectedVersion と operationId を受け、actor・対象・payload hash に結びついた一意な receipt を持つ。同じキー・同じ payload の再送は既存結果を返し、異なる payload は409。API が生成した単一の遷移 receipt を、条件付き UPDATE の勝者だけが記録する。全ての後続 INSERT/UPDATE はその receipt の対象・新version・operationId に対する EXISTS を条件にする。枠カウンターだけ先に更新する構造や、無条件 snapshot/outbox INSERT は禁止。

承認は1つの原子的な D1 batch にまとめる。対象 version・状態・未失効・枠有無を条件に更新し、枠変更・snapshot・outbox・audit は勝者 receipt にのみ従属させる。容量競合も含めて最終整合性 guard を設ける。guard は単なる0行 UPDATE ではなく、同 batch を SQL エラーでロールバックさせる制約違反方式などを検証して採用する。再送時は旧 receipt を新遷移の勝者として扱わない。SQLite スキーマ・D1実環境の対応を確認するまで SQL 実装済みとは扱わない。

受入テスト: 最後の1枠への同時承認で勝者1つ、敗者の枠・公開版・outbox・audit が全てゼロ。重複申請、取り下げ対承認、辞退取消対確定、version不一致、同一 operationId 再送も検証。本文承認と時間割更新は別フィールドを更新し、過去回訂正を古い本文で巻き戻さない。

## 時間割と保持

共通発表時間は質疑込み。全発表直後に入替を置き、最後や休憩・閉会前も省略しない。開会・休憩・閉会は発表枠に数えない。開始前辞退は後続全体を繰上げ、開始後は時刻維持。発表詳細と時間割を同じ公開 revision で更新する。終了後訂正で開催中に戻さない扱いは安全な設計案。

非公開情報は終了／中止確定から3か月で削除する要件。起算点固定・3暦月・月末丸めと timeZone は設定案。メール対応表・token/session・outbox・監査・ログ複製も対象。公開アーカイブは別管理し、中止回の旧公開版を無期限公開保持しない。本段階は dry-run のみ。期限到達後の読取拒否と物理削除再試行を後続で検証し、本番削除は別承認。

## メール・セキュリティ

確認リンク1時間は確定。本人 session 24時間は configurable proposal で本番無効。再発行時の旧リンク、メール変更後session失効、本人調査手順は未確定。GET確認画面でtokenを消費せずPOST交換。乱数tokenはハッシュのみ保存し、一回限り、期限確認、URLやtokenをログに出さない。Referrer-Policy:no-referrer、第三者資源なし、交換後URLからtoken除去。HttpOnly/Secure/SameSite cookie、CSRF、限定CORS、存在秘匿レスポンス、発行制限、毎回の所有者・役割・期限検査が必須。

通知は正式受付・初回承認・差し戻し・再承認・見送り・辞退確定・全体中止の7種類と別枠のメール確認。代表者のみ宛先、時刻変更や運営向け自動通知は追加しない。fake adapterと架空データのみ。メール送信失敗で確定業務を巻き戻さず、outboxで再試行する。外部SMTP等は送信成功後の応答喪失で重複しうるため exactly-once を保証せず、providerの冪等性有無を確認する。ロリポップ送信方式と無料枠、送信元は未確認。

## UI とツール

既存 globals.css の色: ink #17202b / muted #68717d / paper #f5f2eb / panel #fffefb / line #d9d6ce / blue #155eef / hover #0040c1。不要なキャッチコピーと空欄項目の見出しは出さない。

Vite Plus公式 guide と create を2026-10-25確認。公開 apps/lt-web のみにプロジェクトローカル vite-plus を導入し既存パッケージマネージャー経由で vp を実行する。管理 Vinext 全体は移行しない。後続担当が選定版のhelpとNode互換性を確認してscaffoldし、グローバルNode/PMは変更しない。Rust Workerは薄いホスト連携のみとしJS/Wasm往復を抑え、CPUを代表リクエストで実測する。配備先・無料枠適合はまだ保証しない。

参考: https://viteplus.dev/guide/ 、https://viteplus.dev/guide/create

## 検証と未完了

`python -m unittest discover -s contracts/lt -p test_contracts.py -v`。依存は requirements-test.txt、データは example.invalid の架空値。Schema拒否テストはサービスの認可・DB原子性・CSRFの実装検証ではない。後続で全 mutation schema、Rust型とvalidator、D1競合、HTTPルート分離、ブラウザー結合、既存認証回帰を追加する。本番送信・削除・デプロイは行わない。
