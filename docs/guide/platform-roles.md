# PandD 運営ロールと導入手順

## 権限

認証は既存の GitHub OAuth / Device Flow と署名 Cookie を使い、認可は D1 の `platform_roles` を毎回読み直す。GitHub collaborator、Cookie の `isAdmin` / `gameAccess`、旧 `policy_grants`、`music_accounts.admin`、作品別 `music_memberships` は新しい権限の根拠にしない。未登録・未知ロールは一般利用者として管理操作を拒否する。

| 操作 | 一般利用者 | 幹部補佐 (`assistant`) | 幹部 (`executive`) | Admin (`admin`) |
| --- | --- | --- | --- | --- |
| 公開コンテンツの利用 | 可 | 可 | 可 | 可 |
| 全作品のゲームアップロード、説明・画像編集、本番公開 | 不可 | 可 | 可 | 可 |
| 全作品の Music 登録・編集・公開・停止・再公開・再試行 | 不可 | 可 | 可 | 可 |
| ゲームの公開再試行、復旧、正常版への切り戻し・停止・再公開 | 不可 | 可 | 可 | 可 |
| 既存の集計統計と CSV | 不可 | 可 | 可 | 可 |
| 招待 | 不可 | 不可 | 補佐のみ | 幹部・補佐 |
| 役割変更（Admin 昇格を含む） | 不可 | 不可 | 不可 | 可 |
| 物理配布版・Music バナー設定 | 不可 | 不可 | 可 | 可 |
| 完全削除、認証・セキュリティ設定、DB 上書き復元 | 不可 | 不可 | 不可 | Admin の運用権限のみ |

完全削除・認証設定・DB 上書き復元を受け付ける Web/API は現時点では存在しない。この変更で新設しない。Publisher の GC、PHP の保守 CLI、Cloudflare/GitHub 管理権限・バックアップ復元用資格はサービス外の運用境界であり、配布先を Admin に限定する必要がある。`dangerous` 権限は明示的に Admin のみで、HTTP クライアントからサービス用資格を取得する経路はない。未完了 multipart upload のキャンセルと自動保存期限処理は既存のまま。

統計は既存の集計サービスとレスポンス項目の allowlist を維持する。端末識別子、セッショントークン、個人の生ログなどを補佐へ開放しない。

## 公開と復旧

- 全運営メンバーが他のメンバーの申請も操作できる。新規本番公開は成功した Staging、期限、sealed artifact と SHA-256 の一致を引き続き要求する。
- `ready` / 旧 `pending_approval` を直接実行可能にし、指名承認 API を廃止した。復旧時の R2 確認内容の記録も本人が実行できる。
- Actions OIDC、workflow / repository / branch / environment / run の検証は維持する。実行直前には元の申請者ではなく、その試行を開始した人の現在の運営ロールを確認する。権限取消後の queued 実行は拒否する。
- 切り戻し・一時公開停止・再公開は `succeeded` の本番申請かつ正常公開時の manifest SHA-256 記録がある場合だけ開始できる。同じ sealed archive を再検証・署名し、過去の manifest ハッシュと完全一致することを pointer 更新前に確認する。正常本番版への復旧だけは Staging の7日間期限を再要求しない。
- 一時公開停止は公開カタログからの非表示である。既知 URL の無効化やインストール済みゲームの実行停止ではない。停止には現在公開中の版を選択する必要があり、古い版を指定すると pointer 更新前に拒否する。再公開・切り戻しは指定した正常版をカタログへ戻す。
- 署名鍵変更、artifact 消失、過去のハッシュ記録欠落・履歴保存期限経過などで同じ版を検証できない場合、復旧は拒否する。新しい Staging 検証から再公開する必要がある。
- 移行前の正常版でも成功時の manifest ハッシュ記録がなければ対象外となる。ハッシュを推測して補完したり、移行時に正常扱いの記録を作ったりしない。
- 同作品が `dispatched` / `running` / `publishing_pointers` / `verifying` なら復旧開始を拒否する。既存の production workflow は全作品で同じ concurrency group を使い、実行中の公開をキャンセルせず直列化する。ただし API の状態確認から enqueue までの競合や別申請の後続実行まで禁止するロックではない。キューの順序も保証されないため、最後に成功した公開が公開版となる。緊急復旧中は新規公開の投入を運営で調整し、完了後の公開版を確認する。
- 今回のゲーム公開・復旧は既存フローと同じ **Windows x86_64** が対象で、metadata に含まれる表示言語のカタログを更新する。Linux/macOS などの公開 pointer とカタログは変更しない。複数プラットフォームを一括して停止・復旧する機能ではない。
- `audit_events` のハッシュチェーン、Actions の結果 callback、Music の公開記録を維持し、`operation_events` に実行者・対象・HTTP 結果・拒否も記録する。招待・受諾・役割変更の成功記録は同じ DB transaction に保存する。

## 招待と役割変更

`/members` で、すでに GitHub ログイン済みの数値 ID を選択して招待する。メールや外部メッセージは自動送信しない。招待先本人が同じ画面から7日以内に受諾する。招待の役割は DB に固定し、受諾リクエストで role や recipient を上書きできない。本人 ID、有効期限、未使用、現在の発行者権限を SQL 内で再確認する。幹部の招待が改ざんされて幹部向けになっても受諾不可。既存の運営メンバーは招待経由で役割変更できない。

役割変更は Admin のみ。最後の Admin の降格は拒否する。旧利用申請は本人の申請履歴として残り、旧 grant / Music 担当割り当てによる昇格は廃止する。審査者は共通メンバー画面で明示的に招待する。

## 安全な導入（この PR では未実施）

1. 本番 D1 をバックアップし、`users`、`policy_grants`、`music_accounts`、`music_memberships` の既存権限を確認する。バックアップとユーザー情報は PR に添付しない。
2. 本番投入前に運営で数値 GitHub ID と新ロールを確認する。旧 Admin 候補も自動移行しない。旧 requester / approver / production_requester や Music 作品担当は全作品・全サービス権限に対応しないため、自動的に補佐へ変換すると権限拡張になる。対応付けは未決定であり、確認できない人は一般利用者のままにする。
3. 隔離 Staging で `0006_platform_roles.sql` を適用し、確認済みの Admin 本人だけを `platform_roles` に明示登録する。`changed_by` と `changed_at`、別途の導入作業記録に担当 Admin と結果を残す。値を推測した一括 `INSERT ... SELECT` は使用しない。この PR には実ユーザー ID を含む権限付与 SQL を入れていない。
4. 本番 DB の構造適用・確認済み Admin の登録・Worker と production workflow の更新を同じ保守作業で行う。Worker は空のロール表を安全側で拒否するため、Admin 未登録のまま切り替えると管理画面が利用不能になる。旧 Worker を残したまま移行を完了したと扱わない。
5. Admin が `/members` から確認済みメンバーを招待する。既存 Cookie も毎回 DB で再評価される。未登録ユーザーの旧 grant はアクセスを復活させない。
6. 各ロールで直接 API、他作品公開、承認なし本番公開、取消済みユーザーの Actions preflight、招待改ざん、正常版の停止・切り戻しを Staging で確認する。公開サービス用資格は従来通りサーバー側だけに置く。
7. GitHub `production` Environment に required reviewers がないことを再確認する。2026-10-14 の読み取り確認では `branch_policy` のみで、人の承認ルールはなかった。Cloudflare 設定、GitHub Environment、実ユーザー権限、本番デプロイ、ライブ DB 移行はこの作業では変更していない。

導入を戻す際はロールを広げるフォールバックを追加しない。DB バックアップ復元は Admin の別作業として扱い、公開 pointer と DB の状態を突き合わせる。旧 Worker へ戻すと旧権限体系が再び有効になるため、承認済みの運用判断を要する。

Docs 編集 Worker は独立した認証・DB を持つ別サービスで、このロール表を参照しない。この PR の対象は GameLauncher / Music の管理、配布版、統計。Docs 編集権限の統合には別途認証境界の設計が必要。
