# PandD Deployment Control Plane

ゲーム公開の申請、申請ごとの承認者指名、承認・却下、権限設定、監査履歴を扱う
Cloudflare Workersアプリケーションです。

Phase 2のartifact作成、非公開intakeへのmultipart upload、再開、sealまで実装済みです。
StagingとProductionの申請、別アカウント承認、GitHub Actions起動、結果通知まで実装済みです。
外部設定が揃うまでは環境別のkill switchにより実workflowを起動できません。

## ローカル起動

リポジトリルートから次を実行し、`http://localhost:3000`を開きます。

```powershell
.\scripts\local\Run-DeploymentControlPlane.ps1
```

初回だけ依存関係とGit管理外の`.dev.vars`を準備します。通常のNode.js環境では
`apps/admin-web`ディレクトリで`npm run dev`を実行することもできます。

## CLionからCloudflareへデプロイ

共有実行構成 `Control Plane: Cloudflare deploy` を選び、実行してください。
この構成は `apps/admin-web` の `npm run deploy:cloudflare` を呼び出します。
初回は先にターミナルで `npx wrangler login` を実行し、Cloudflare認証を完了してください。
デプロイ前の検証には `npm test` を使用します。秘密値は実行構成へ追加せず、
本番用Worker secretは `npx wrangler secret put <NAME>` で設定してください。

`LOCAL_DEV_AUTH=true`はlocalhostでだけ有効です。Admin、申請者、承認者を切り替えて、
申請から指名承認までを確認できます。

## Web版 Intake（推奨フロー）

ブラウザ上で `http://localhost:3000/intake` （または本番URLの `/intake`）を開くことで、ローカルにPython/PySide6環境を用意することなく、ブラウザ完結でArtifact作成とIntakeへのアップロード・Sealを行えます。通常利用において `PandDIntakeUploader.exe` は不要です。

### 主な機能
- **Artifact作成モード（推奨・デフォルト）**:
  - ゲーム情報（Game ID、Version、Minimum Launcher Version、Engine、Save Directory Name）の入力・即時バリデーション
  - 多言語表示情報（ja-JP必須、追加言語タグのバリデーション、Name 1..100文字、Summary 1..500文字）
  - Hero画像・Thumbnail画像（PNG / JPEG / WebP）のプレビュー、Hero焦点位置（Focal Point）のインタラクティブ指定（画像クリックまたは数値入力）
  - Buildフォルダ（`<input webkitdirectory>`）の一括選択、ファイル数・容量・パス安全性（Windows予約名、大文字小文字衝突、240文字制限、空ファイル拒否）の検証
  - 起動EXE（Entrypoint）の自動検出と候補ソート
  - release.json（`game-release-source.schema.json` 準拠）の自動生成
  - 決定論的 ZIP64 アーカイブ生成（タイムスタンプ 1980-01-01 固定、Deflate圧縮。CompressionStream出力chunkを直ちにBlob-backed partへ移し、JSヒープ上の全bytes保持やProcessedEntryでの圧縮body保持を排除してメモリを最適化）
  - インクリメンタル SHA-256 計算
  - descriptor（`deployment-artifact-descriptor.schema.json` 準拠）の自動構築
  - 非公開Intakeへの64 MiB part分割アップロード（最大4並列、自動リトライ、キャンセル、Seal）
  - デバッグ用 Descriptor / Artifact ZIP のダウンロード保存機能
  - ※ブラウザ制約: 現行ブラウザAPI上、生成した最終ZIPはSHA-256検証およびアップロード用に単一Blob/Fileとして保持されます。圧縮処理中のJSヒープ消費は最小化されますが、ブラウザ全体のメモリ/Blobストレージとして成果物ZIP容量（上限5 GiB）を保持します。
- **既存Artifactアップロードモード（互換用途）**:
  - 既存の `*.pandd-artifact.json` と `*.zip` をドラッグ&ドロップまたは選択してアップロード

### 推奨作業手順
1. Control Planeへログイン
2. Web版 Intake（`/intake`）を開く
3. STEP 1: ゲーム基本情報を入力
4. STEP 2: 多言語表示情報とHero / Thumbnail画像を選択（焦点位置を指定）
5. STEP 3: Buildフォルダを選択し、起動EXEを確認
6. STEP 4: プレビュー内容を確認し、「Artifactを作成してアップロード」を実行
7. 完了後、Control Planeの申請画面（`/`）で公開申請を作成・承認・実行

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
.\scripts\local\Run-IntakeUploader.ps1
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

## スキーマバリデーション

contracts内のcanonical JSON Schema（`deployment-artifact-descriptor.schema.json`, `game-release-source.schema.json`）をsource of truthとして、Ajv Standalone Code Generationにより事前生成されたバリデーター（`lib/generated/schema-validators.js`）を使用します。Workers/RSC環境での実行時eval/new Functionを排除しています。

スキーマ変更時は次でバリデーターを再生成します（`npm run dev`, `npm run build` 実行時にも自動実行されます）:

```bash
npm run schema:generate
```

## データ

D1の論理bindingは`DB`、非公開R2の論理bindingは`INTAKE`です。ローカル開発では起動時に不足テーブルを作成します。
正式なschema変更では`npm run db:generate`でDrizzle migrationを生成して保存します。
