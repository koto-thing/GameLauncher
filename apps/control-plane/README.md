# PandD Deployment Control Plane

ゲーム公開の申請、申請ごとの承認者指名、承認・却下、権限設定、監査履歴を扱う
Cloudflare Workersアプリケーションです。

Phase 2のartifact作成、非公開intakeへのmultipart upload、再開、sealまで実装済みです。
StagingとProductionの申請、別アカウント承認、GitHub Actions起動、結果通知まで実装済みです。
外部設定が揃うまでは環境別のkill switchにより実workflowを起動できません。

## ローカル起動

リポジトリルートから次を実行し、`http://localhost:3000`を開きます。

```powershell
.\scripts\Run-DeploymentControlPlane.ps1
```

初回だけ依存関係とGit管理外の`.dev.vars`を準備します。通常のNode.js環境では
`apps/control-plane`ディレクトリで`npm run dev`を実行することもできます。

`LOCAL_DEV_AUTH=true`はlocalhostでだけ有効です。Admin、申請者、承認者を切り替えて、
申請から指名承認までを確認できます。

## Web版 Intake Uploader（推奨）

ブラウザ上で `http://localhost:3000/intake` （または本番URLの `/intake`）を開くことで、Windows Defender等の誤検知を受けることなくIntakeへのアップロードとSealを行えます。

- **descriptor JSON** と **artifact ZIP** をドラッグ&ドロップまたは選択
- スキーマ検証、ZIP名・容量の整合性チェック
- チャンク分割によるメモリ消費を抑えたブラウザ側 SHA-256 検証
- 64 MiB part の最大4並列アップロード、通信失敗時の自動指数リトライ
- アップロードキャンセル、進捗表示、Seal処理
- 既存のControl Planeセッション（HttpOnly cookie）とGitHub OAuthをそのまま再利用

### R2 direct-r2 用 CORS 設定

ブラウザからR2へ直接PUT (`direct-r2` 転送) する場合、R2バケットにCORS設定が必要です。
リポジトリ内の `r2-cors.json` を使用して設定します：

```bash
# Cloudflare CLIでIntakeバケットへCORSを適用
npx wrangler r2 bucket cors set pandd-launcher-intake --file r2-cors.json
```

設定では `AllowedOrigins` をControl Planeの正規Originに限定し、`ExposeHeaders` に `ETag` を指定してブラウザ側でのmultipart part ETag取得を許可しています。

なお、S3クレデンシャル未設定時の `worker-proxy` モードでは同一Origin経由で転送されるため、R2のCORS設定なしでも動作します。

## デスクトップ版 Intake Uploader（互換性維持）

従来のPySide6製デスクトップアプリも引き続き利用可能です：

```powershell
.\scripts\Run-IntakeUploader.ps1
```

uploaderはZIPの容量とSHA-256を再検証し、64 MiB partを最大4並列で非公開intakeへ送ります。
中断後は同じdescriptorから完了済みpartを再利用して再開できます。seal完了後、生成された
`.pandd-artifact.json` を「新しい申請」で選択するとartifact情報を読み込みます。

ローカル開発ではWorkersのローカルR2 bindingを経由します。Cloudflareへ配置するときは
intake bucketだけへ書き込めるR2 API tokenを用意し、次の値をcontrol planeへ設定します。

```text
INTAKE_R2_ACCOUNT_ID
INTAKE_R2_BUCKET
INTAKE_R2_ACCESS_KEY_ID
INTAKE_R2_SECRET_ACCESS_KEY
```

値をソース、ログ、画面、監査payloadへ出力しないでください。part URLは15分で失効します。

## GitHub Appログイン

GitHub Appのcallback URLを次へ設定し、`.dev.vars`へClient IDとClient Secretを設定します。

```text
http://localhost:3000/api/auth/github/callback
```

ログイン時に`koto-thing/GameLauncher`のrepository owner IDを取得し、ログインしたGitHub
user IDと一致するときだけAdminとして扱います。tokenはD1やセッションcookieへ保存しません。
desktop uploader用にGitHub App設定の「Enable Device Flow」も有効にします。Device Flowで得た
user tokenはuploaderのメモリ内だけに保持し、D1、ファイル、ログへ保存しません。

## Staging Actionsを有効にするとき

control planeにはGitHub Appのinstallationとしてworkflow dispatchするため、次を設定します。

```text
GITHUB_APP_ID
GITHUB_APP_INSTALLATION_ID
GITHUB_APP_PRIVATE_KEY
GITHUB_REPOSITORY_ID
```

GitHub Appには対象repositoryの`Actions: write`と`Contents: read`だけを許可します。
Repository Variable `DEPLOYMENT_CONTROL_PLANE_URL`にはHTTPSのcontrol plane URLを設定します。
さらに、staging Environmentとworkflowを準備して検証し終えるまでは
`STAGING_DISPATCH_ENABLED=false`を維持します。Stagingの外部設定と受入確認が終わったときだけ`true`へ変更します。

staging Environmentを追加する段階で、次のEnvironment Secretsを設定します。

```text
MANIFEST_PRIVATE_KEY_PEM
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ENDPOINT
```

workflow内のbucketと公開Base URLはstaging値へ固定済みです。Environmentを作成するまでは、
画面の「Stagingへ実行」を押さないでください。値そのものをログやgitへ追加しないでください。

## Production Actionsを有効にするとき

成功済みStagingと同じArtifact ID・SHA-256を7日以内にProduction申請へ進めます。
Production申請はAdminを含めてbypassできず、申請者とは別の指名承認者が必要です。

GitHub Environment `production`へRequired reviewersを設定し、Production専用の次のSecretsを登録します。

```text
MANIFEST_PRIVATE_KEY_PEM
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ENDPOINT
```

同じ`production` Environmentをランチャー本体の公開にも使うため、そちらを有効にするときは
`MANIFEST_PUBLIC_KEY_BASE64`と`R2_BUCKET=pandd-launcher-production`も登録します。

`pandd-launcher-production` bucket、`https://downloads.koto-thing.com`、署名鍵、承認者を確認後、
`PRODUCTION_DISPATCH_ENABLED=true`へ変更してWorkerを再公開します。Stagingの鍵やR2 tokenを再利用しません。

## データ

D1の論理bindingは`DB`、非公開R2の論理bindingは`INTAKE`です。ローカル開発では起動時に不足テーブルを作成します。
正式なschema変更では`npm run db:generate`でDrizzle migrationを生成して保存します。
