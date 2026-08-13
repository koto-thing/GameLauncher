# ゲームデプロイ管理システム設計

## 1. 目的と適用範囲

PandDのゲーム公開を、GitHubアカウントで認証された利用者がWebアプリケーションから
設定、申請、承認、却下、キャンセル、履歴確認できるようにする。

ゲームビルドの最終的な署名と公開はGitHub Actionsだけが行う。Webアプリケーションと
デスクトップアプリケーションには、stagingまたはproductionの署名秘密鍵とR2書き込み
認証情報を渡さない。

この設計はゲーム公開を対象とする。既存のランチャー公開workflowとは分離する。
productionへのデプロイ、GitHub EnvironmentやSecretsの変更、R2オブジェクトの削除は、
それぞれ明示的に承認された実装・運用フェーズまで行わない。

## 2. 確定要件

- リポジトリは個人GitHubアカウントが所有するPublicリポジトリとする
- Repository OwnerをAdminとして扱う
- 個人リポジトリにはMaintainロールがないため、AdminがWebアプリケーション上で
  許可したCollaboratorをPandDのMaintain相当申請者として扱う
- Maintain相当申請者は、自分以外のGitHubアカウント1人から承認を得る
- 承認者は申請ごとにAdminが指名する
- 同一GitHub user IDによる自己承認と二重承認を拒否する
- Adminによる申請は追加承認を不要とし、`admin_bypass` と理由を監査記録する
- stagingとproductionに同じ承認規則を適用する
- production申請者はAdminが許可したGitHub user IDだけに限定する
- production申請は、成功済みstaging requestと同じartifact IDおよびSHA-256を必須とする
- 最大ビルド容量は5 GiB、最大ファイル数は50,000とする
- production申請期限はstaging成功から7日間とする
- stagingとproductionのバケット、URL、署名鍵、R2認証情報を完全に分離する
- productionではintake上の同一ビルドから本番URL用マニフェストを新規生成し、
  production鍵で新しく署名する
- stagingで生成した署名済みマニフェストをproductionへコピーしない

## 3. 推奨構成

保守対象と外部サービスを増やしすぎないため、control planeをCloudflare上へまとめる。

- Web/API: Cloudflare Workers
- Web UI: Workers Static Assets
- データベース: Cloudflare D1
- ゲーム受入領域: 非公開intake R2 bucket
- 認証: GitHub AppのWeb application flow
- 大容量アップロード: R2 S3 APIのpresigned multipart upload
- 公開実行: GitHub-hosted Actions runner
- 公開先: staging R2とproduction R2

Workersはintake bucketだけへアクセスできる。stagingとproductionのR2資格情報および
Ed25519秘密鍵は、対応するGitHub Environment Secretsだけに保存する。

既存PySide6パネルは公開ツールではなくintake uploaderへ変更する。フォルダ選択、
入力検証、安全なアーカイブ生成、SHA-256計算、multipart upload、再開だけを担当する。
申請、承認、却下、設定、履歴はWeb UIだけを正とする。

## 4. 信頼境界

### 4.1 Web control plane

保持してよい秘密情報はGitHub App秘密情報、セッション署名鍵、D1アクセス権、intake専用
R2資格情報だけとする。公開先R2資格情報と署名秘密鍵は保持しない。

### 4.2 Desktop intake uploader

長期資格情報を保持しない。GitHub device flowまたはブラウザログインから得た短時間の
アプリケーションセッションと、特定upload ID・part番号に限定したpresigned URLだけを
使用する。URL、token、ローカル絶対パスをログへ出力しない。

### 4.3 GitHub Actions

workflowを次の2本へ分離する。

- `deploy-game-staging.yml`: `staging` Environmentだけを参照
- `deploy-game-production.yml`: `production` Environmentだけを参照

Secretsを使わないpreflight jobと、Environment Secretsを使うpublish jobを分ける。
publish jobはpreflight成功後だけ開始する。

### 4.4 R2

- intake: 非公開、受入専用、公開URLなし
- staging: staging URL、staging署名、staging限定書き込みtoken
- production: production URL、production署名、production限定書き込みtoken

各tokenは1 bucketだけへスコープする。バケット名とBase URLはworkflow内の固定値または
Environment Variablesとし、requestから自由入力させない。workflowは期待する環境値との
一致を実行前に検証する。

## 5. 認証と権限

利用者の識別には変更可能なlogin名ではなく、GitHubの数値user IDを使う。login名は
監査画面用のsnapshotとして保存する。

ログイン時と重要操作時にGitHub APIで現在のrepository permissionを再確認する。

- Admin: repository owner
- Maintain相当: collaboratorかつ`requester_grants`でAdminが許可したuser ID
- Approver候補: `approver_grants`でAdminが許可したuser ID
- Production requester: `production_requester_grants`でAdminが許可したuser ID

承認・却下・admin bypass・production申請は、直近15分以内にGitHubで再認証された
セッションを要求する。

## 6. 申請ごとの承認規則

Adminはrequest提出前に1人以上の承認者をGitHub user IDで指名する。提出後はrequest、
artifact、承認者指名を変更できない。変更が必要な場合は新しいrequest IDを作成する。

Maintain相当申請者のrequestは次をすべて満たしたときだけapprovedとなる。

1. requesterが提出時と実行時の両方でMaintain相当である
2. 指名承認者が提出時と承認時の両方でapprover allowlistに含まれる
3. approverのGitHub user IDがrequesterと異なる
4. 指名承認者のうち1人以上がapproveしている
5. reject、cancel、失効が記録されていない

Admin申請は指名承認者を要求せず、理由を必須とする`admin_bypass`イベントでapprovedにする。

GitHub Environmentでもrequired reviewersとprevent self-reviewを有効にする。Environmentの
reviewer設定は静的であるため、指名承認者との一致はcontrol planeとActions preflightが
検証する。Environment reviewerには指名対象になり得る個別アカウントの集合を設定する。

## 7. データモデル

### `users`

- `github_user_id` primary key
- `login_snapshot`
- `last_verified_at`

### `policy_grants`

- `github_user_id`
- `grant_type`: `requester`, `approver`, `production_requester`
- `granted_by_github_user_id`
- `granted_at`, `revoked_at`

### `artifacts`

- `artifact_id` UUID
- `intake_object_key`
- `size_bytes`
- `file_count`
- `claimed_sha256`
- `sealed_at`
- `status`

`intake_object_key`には利用者入力を含めず、UUIDだけから生成する。sealed後は同じartifactの
再アップロードURLを発行しない。異なるbytesへ置換されてもActionsでSHA-256不一致となる。

### `deployment_requests`

- `request_id` UUID
- `environment`: `staging`または`production`
- `artifact_id`
- `artifact_sha256`
- `metadata_json`
- `metadata_sha256`
- `requester_github_user_id`
- `source_staging_request_id` nullable
- `state`
- `created_at`, `submitted_at`
- `production_eligible_until` nullable

productionでは`source_staging_request_id`を必須にし、そのrequestが`succeeded`であること、
artifact IDとSHA-256が完全一致すること、成功から7日以内であることを検証する。

### `request_approvers`

- `request_id`
- `approver_github_user_id`
- `designated_by_github_user_id`
- `designated_at`
- unique `(request_id, approver_github_user_id)`

### `approval_decisions`

- `request_id`
- `approver_github_user_id`
- `decision`: `approved`または`rejected`
- `reason`
- `decided_at`
- unique `(request_id, approver_github_user_id)`

### `execution_attempts`

- `attempt_id` UUID
- `request_id`
- `attempt_number`
- `github_run_id`, `github_run_attempt`
- `workflow_commit_sha`
- `stage`
- `result`
- `started_at`, `finished_at`

### `audit_events`

- `event_id` UUID
- `request_id` nullable
- `sequence`
- `event_type`
- `actor_github_user_id` nullable
- `actor_login_snapshot` nullable
- `occurred_at`
- `payload_json`
- `previous_event_hash`
- `event_hash`

監査イベントは更新・削除せず追記する。payloadには秘密、presigned URL、token、秘密鍵の
パス、利用者PCの絶対パスを含めない。

## 8. Artifact形式と上限

uploaderはビルドフォルダ、release metadata、hero、thumbnailを1個のZIP64 artifactへ
格納する。パスはUTF-8の`/`区切りへ正規化し、絶対パス、`..`、symlink、重複パス、
大文字小文字だけが異なる衝突、Windows予約名を拒否する。

- 非圧縮合計: 5 GiB以下
- artifact object: 5 GiB以下
- entry数: 50,000以下
- path長: Publisherの既存制約に合わせて240文字以下
- 空ファイル: 現行Publisherが拒否するため受付時点で拒否
- multipart part size: 64 MiB
- 同時upload part数: 初期値4
- presigned URL有効時間: 15分、必要なpartだけを追加発行

SHA-256はartifact全体をストリーム計算する。R2 multipart ETagはartifact SHA-256として
使用しない。uploaderの申告hashをrequestへ固定し、Actionsがダウンロード後に必ず再計算する。

## 9. 状態遷移

requestの主要状態を次に限定する。

```text
draft -> uploading -> ready -> pending_approval -> approved -> dispatched
      -> running -> publishing_pointers -> verifying -> succeeded
```

例外状態:

- `rejected`: 承認者による却下。終端
- `cancelled`: pointer昇格前のキャンセル。終端
- `expired`: production申請期限切れ。終端
- `failed_retryable`: 同じrequestとartifactで再試行可能
- `failed_terminal`: hash不一致、immutable衝突、ポリシー不成立など
- `recovery_required`: mutable pointer更新途中で失敗し、同一requestの再実行が必要

実行工程の詳細はrequest stateへ増やさず`execution_attempts.stage`へ記録する。

## 10. GitHub Actions連携

WebアプリケーションはGitHub App user access tokenを使って申請者として
`workflow_dispatch`を実行する。入力は`request_id`と`attempt_id`だけにする。

preflight jobは`id-token: write`と`contents: read`だけを持ち、GitHub OIDC tokenを
control planeへ提示する。control planeはrepository、workflow、environment、ref、run IDを
検証してrequest snapshotを返す。

workflow内のローカルpolicy verifierが次を再検証する。

1. requestとartifactがimmutableである
2. environmentとworkflowが一致する
3. requester、指名承認者、approval decisionがポリシーを満たす
4. production requester grantが現在も有効である
5. productionが成功済みstaging requestと同じartifactを参照する
6. requestがcancelled、rejected、expiredでない
7. attempt IDが未使用である
8. intakeから取得したartifactのサイズとSHA-256が一致する
9. 展開後のentry数、合計容量、path制約が一致する

publish jobは環境単位のconcurrency groupを使用し、`cancel-in-progress: false`とする。
共有カタログ更新のlost updateを防ぐため、1環境につき常に1デプロイだけを実行する。

Publisher実行前に現在の対象言語カタログを対象R2から取得して作業treeへseedし、既存ゲームを
保持したまま対象ゲームだけを更新する。immutable objectsをアップロード・検証した後、
catalogとlatestを昇格し、公開URLからmanifestと全対象localeを再検証する。

## 11. 再試行とキャンセル

同じrequestの再試行は新しい`execution_attempts`を作り、request、artifact、metadata、
承認を変更しない。ネットワーク障害、runner障害、GitHub一時障害はretryableとする。

次の場合は新しいrequestと再承認を必要とする。

- artifact、SHA-256、metadata、version、game ID、entrypointの変更
- staging成功から7日を超えたproduction申請
- 指名承認者の変更

キャンセルは次の境界で扱う。

- upload中: multipartを停止し、requestをcancelledにする
- pending approval: 即時cancelled
- dispatchedからimmutable upload完了前: Actions runへcancelを要求
- pointer昇格開始後: cancelを拒否し、完了またはrecovery_requiredまで継続

immutable objectはキャンセル時に削除しない。multipart abortや期限切れintake artifactの
削除は、デプロイとは別の保守処理として設計・承認する。

## 12. 監査記録

少なくとも次を記録する。

- request作成、変更、提出
- requester grant、approver grant、production requester grantの付与・取消
- 指名承認者
- approve、reject、admin bypassと理由
- cancel要求、受付、拒否
- artifact ID、サイズ、ファイル数、SHA-256
- metadata SHA-256
- workflow dispatch、run ID、attempt、workflow commit SHA
- Actions側の再検証結果
- immutable upload完了、pointer昇格開始、事後検証
- 成功、失敗、retry、recovery

GitHub Actionsログにはrequest ID、artifact SHA-256、公開されたmanifest digest、件数、結果だけを
出力する。metadata本文、presigned URL、R2 endpoint資格情報、秘密鍵を出力しない。

## 13. 失敗を閉じるための規則

- control planeへ接続できない場合はデプロイしない
- GitHub permissionを確認できない場合は権限なしとして扱う
- approval情報が不完全または矛盾する場合はデプロイしない
- artifact hashが一致しない場合はR2公開処理を開始しない
- workflowが保護されたmaster以外から実行された場合はデプロイしない
- bucket、Base URL、署名鍵の公開鍵fingerprintが環境固定値と違う場合はデプロイしない
- immutable objectが同じkeyで異なるmetadataまたはbytesを持つ場合は上書きしない
- pointer更新途中の失敗を成功扱いせず`recovery_required`にする

## 14. 段階的実装

### Phase 0: GitHub権限PoC

- GitHub Appログイン
- ownerとcollaboratorの判定
- user access tokenによるworkflow dispatchのactor確認
- Environment required reviewersとprevent self-reviewの挙動確認

### Phase 1: Control plane最小版

- Workers、Static Assets、D1 migrations
- user、policy grant、request、指名承認、audit event
- staging requestをapprovedまで進めるUIとAPI
- R2、Actions、Secretsにはまだ接続しない

### Phase 2: Intake uploader

- [実装済み] PySide6パネルから直接署名・直接R2公開を除去
- [実装済み] ZIP64生成、5 GiB・50,000 entry制限、SHA-256
- [実装済み] symlink、reparse point、危険なパス、空ファイル、大小文字衝突の拒否
- [実装済み] 秘密情報と絶対パスを含まないdescriptorの生成とWeb申請への読込
- [実装済み] 15分のpresigned multipart upload、64 MiB part、最大4並列、再開
- [実装済み] R2 object容量の再検証とartifact sealing

### Phase 3: Staging E2E

- [実装済み] `deploy-game-staging.yml`（外部設定と実環境試験は未実施）
- [実装済み] repository ID・workflow ref・master refを固定するOIDC preflight
- [実装済み] Actions側のSHA-256・容量・件数・ZIP path・metadata再検証
- [実装済み] Publisher runner対応とimmutable/pointer二段階公開
- [実装済み] staging environment concurrency
- [実装済み] 実行stage・成功・失敗・recovery callbackと監査

### Phase 4: 運用安全性

- [実装済み] reject、staging admin bypass、cancel、retry、recovery承認
- [外部設定] Environment required reviewersとprevent self-review
- [実装済み] 監査画面とProduction期限表示
- [実装済み] GCをゲームデプロイworkflowから分離

### Phase 5: Production

- [実装済み] production requester allowlist
- [実装済み] 成功済みstaging artifactの7日間制約と同一SHA-256検証
- [実装済み] production専用workflowと環境別kill switch
- [外部設定] production Environment、Required reviewers、鍵、R2資格情報
- [実装済み] 本番URL用manifest再生成とproduction再署名
- [実装済み] staging成功と別アカウント承認後にのみproduction実行を許可

### Phase 6: 任意のブラウザアップロード

デスクトップ経路が安定した後、既に作成済みの単一artifactをWebブラウザから送る経路を
追加する。フォルダのブラウザ内圧縮は初期版に含めない。

## 15. GitHub Environment設定時に必要な入力

Environment reviewerは個別GitHubアカウントを静的登録する必要がある。実際の設定変更前に
次をAdminが明示する。

- staging reviewer候補のGitHubアカウント、最大6人
- production reviewer候補のGitHubアカウント、最大6人
- stagingとproductionで同じ候補集合を使うか
- Admin bypassをGitHub Environmentでも許可するか

requestごとの指名はこの静的候補集合の中から行う。Environment Secretsの値は設定確認、
画面、ログ、git diff、監査payloadへ出力しない。
