# PandD Deployment Control Plane

ゲーム公開の申請、申請ごとの承認者指名、承認・却下、権限設定、監査履歴を扱う
Cloudflare Workersアプリケーションです。

Phase 2のartifact作成、非公開intakeへのmultipart upload、再開、sealまで実装済みです。
Maintain相当（requester）またはAdminは申請作成時に承認なしでGitHub Actionsを起動します。
既存の準備中・承認待ち申請も、申請者本人またはAdminが「公開する」で直接実行できます。
Adminは他のユーザーの申請も実行でき、実行ごとの監査記録とAdmin権限をpreflightで確認します。
Production申請権限と成功済みStagingの有効期限は引き続き必要です。
Production申請権限だけを持つユーザーは指名承認を必要とします。
外部設定が揃うまでは環境別のkill switchにより実workflowを起動できません。

## ローカル起動

`npm ci` で依存関係を導入し、`npm run lint` でESLint 10とOxlintの両方を実行します。ReactとJSXアクセシビリティの検査は[Oxlintの組み込みルール](https://oxc.rs/docs/guide/usage/linter/plugins.html)で行い、Next・Hooks・TypeScriptの検査はESLintで行います。TypeScriptはtypescript-eslintが対応する6.0系を固定しています。React 19では不要なPropTypesとJSX変数補助ルールは使用せず、非推奨ライフサイクルは`react/no-unsafe`等で検査します。生成済みのMusic管理バンドルはLint対象に含めません。

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

新しいcheckoutから公開するときは、Admin Webに加えてMusic管理画面の依存関係も導入します。

```powershell
# apps/admin-webで実行
npm ci
npm ci --prefix ../music
npm run lint
npm test
npm.cmd run deploy:cloudflare -- --skip-build
```

最後の`--skip-build`は、直前の`npm test`で検証した`dist`を公開します。PowerShellでnpmへ`--`以降の引数を渡すときは、`npm.ps1`による引数の欠落を避けるため`npm.cmd`を指定します。通常の`npm run deploy:cloudflare`やCLion実行ではビルドも行います。どちらも`predeploy:cloudflare`が既存の`prebuild`を呼び、SchemaバリデーターとMusic管理画面の生成を済ませます。`vinext-cloudflare`自身のビルドはnpmの`prebuild`を呼ばないため、この準備をnpmの公開コマンドに含めています。

専用の自動公開workflowはなく、GitHub Actionsの`Music validation`でAdmin WebのテストとLintを検証します。PRの全チェック成功とマージを確認し、マージ済みcommitのcheckoutから上記コマンドを実行します。Cloudflareへの設定・公開には既存のWranglerログイン、または対象アカウントへの権限を持つ`CLOUDFLARE_API_TOKEN`が必要です。

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
7. 完了後、Control Planeの申請画面（`/game`）で公開申請を作成（Maintain相当以上はそのまま公開処理を開始）

ルート（`/`）はサービス選択画面です。GameLauncherのWeb Uploader / Intaker（`/intake`）、公開申請・設定（`/game`）、Music Uploader（`/music`）へ移動できます。

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
Actions OIDCはrepository ID、owner/name、workflow、branchを固定し、repository visibilityは
`private`と`public`のどちらでも受け入れます。それ以外のvisibility claimは拒否します。
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

ログインと管理操作の有効時間は3時間です。
申請一覧は先頭4件分の高さに制限し、5件目以降は一覧内でスクロールします。
毎日03:00（日本時間）に、作成・最終監査イベント・最終実行から365日を過ぎた
完了状態（成功・却下・取消・再試行不可の失敗）の申請と関連する承認・実行・監査ログを削除します。
進行中・再試行待ち・復旧待ちの申請、および他の申請が参照するStaging申請は保持します。
Artifact、公開済みゲーム、システム全体の監査ログは削除対象に含みません。

D1の論理bindingは`DB`、非公開R2の論理bindingは`INTAKE`です。ローカル開発では起動時に不足テーブルを作成します。
正式なschema変更では`npm run db:generate`でDrizzle migrationを生成して保存します。

## ゲーム利用統計

ホームの「ゲーム利用統計」から`/analytics`を開きます。GitHubログイン済みの運営Adminだけが閲覧でき、ページと`GET /api/analytics/games`の両方で権限を確認します。requesterやapproverへ統計閲覧権限は付与しません。ランチャーで統計送信に同意したインストールの集計を表示し、人数としては扱いません。

日付は日本時間、初期表示はProductionの直近30日です。環境・期間・ゲームID・バージョンで絞り込み、起動回数、実行時間、終了結果、時間分布、翌日・7日後の再訪、計測中断率を確認できます。各グラフには日別の表があり、現在表示しているゲーム別・日別集計をCSVへ保存できます。再訪率は分母を表示し、再訪判定の日が終わっていないインストールを分母から除外します。基準日は保存中の直近90日の詳細で最初に観測した起動成功日で、90日より前からの継続利用と新規利用を区別できません。バージョン指定時はそのバージョンの初回観測を使います。日別集計は最大366日、インストール数・中央値・再訪率は直近90日です。詳細保存期間を過ぎた記録の集計が含まれる場合は、詳細項目を「保存期間外」と表示します。

接続設定は次の順で準備します。統計用DBとWorkerは、既存の申請・認証DBから独立しています。

1. `services/platform-api`でStagingとProductionそれぞれのD1を作成し、`wrangler.jsonc`の各`ANALYTICS_DB.database_id`へ実IDを設定します。各環境の`ALLOWED_GAME_IDS`に対象ゲームIDをカンマ区切りで登録し、各DBへmigrationを適用します。環境名とDBを混在させません
2. Platform APIのStaging Worker（`pandd-platform-api-staging`）とProduction Worker（`pandd-platform-api`）を準備し、それぞれに異なる`ANALYTICS_READ_TOKEN`をWorker secretとして登録します。ProductionはPlatform APIの`--env production`を使います
3. Admin Webの`PLATFORM_API`をProduction Worker、`PLATFORM_API_STAGING`をStaging Workerへ接続します。名前は`wrangler.jsonc`に定義済みです
4. Admin WebへProductionの読み取りtokenを`ANALYTICS_READ_TOKEN`、Stagingの読み取りtokenを`ANALYTICS_READ_TOKEN_STAGING`として登録し、ビルドを検証してAdmin Webをデプロイします
5. ランチャーの環境ごとの統計URLを設定し、統計送信を有効にしたテスト用インストールで起動・終了・再送を確認します。Adminとしてログインし、Stagingの集計とProductionの集計が分離されていることを確認します

Admin Webのsecretは、`apps/admin-web`で次を実行して入力します。APIに設定した対応環境のtokenと同じ値を入力し、秘密値をソースや公開環境変数へ追加しません。

```powershell
npx wrangler secret put ANALYTICS_READ_TOKEN
npx wrangler secret put ANALYTICS_READ_TOKEN_STAGING
```

Admin WebはService Bindingを通して集計を取得し、ブラウザには読み取りtoken、インストールID、セッションIDを返しません。接続やsecretが未設定なら「統計サービスが未設定です」、上流の障害なら取得失敗を表示します。Staging接続の不備をProduction接続で補完しません。

インストール数と再訪は、当日の起動成功または正の実行時間を記録した利用を数えます。日をまたぐ継続実行も含みます。計測中のセッションで状態更新が10分を超えて途切れた場合は中断として暫定表示し、後から受信した記録で集計を更新します。

ローカル検証では、Platform APIの`.dev.vars`にStaging用、`.dev.vars.production`にProduction用の`ANALYTICS_READ_TOKEN`を設定し、Admin Webの`.dev.vars`へ対応する`ANALYTICS_READ_TOKEN_STAGING`と`ANALYTICS_READ_TOKEN`を設定します。ローカル専用の異なるtokenを使い、本番の秘密値をコピーしません。

別々のターミナルで次を起動します。DBの保存先とHTTP・Inspectorのポートも分け、未設定のD1 IDを使ったローカル検証でも環境が混在しないようにします。

```powershell
# ターミナル1: services/platform-apiでStagingを起動
npm.cmd run db:local -- --persist-to .wrangler/state/analytics-staging
npm.cmd run dev -- --port 8787 --inspector-port 9230 --persist-to .wrangler/state/analytics-staging

# ターミナル2: services/platform-apiでProductionを起動
npm.cmd run db:local -- --env production --persist-to .wrangler/state/analytics-production
npm.cmd run dev -- --env production --port 8788 --inspector-port 9231 --persist-to .wrangler/state/analytics-production

# ターミナル3: apps/admin-webで管理画面を起動
npm run dev
```

ViteとWranglerの別プロセスは、設定済みのWorker名でService Bindingを接続します。[Cloudflareの複数Worker開発手順](https://developers.cloudflare.com/workers/local-development/multi-workers/#multiple-dev-commands)に対応し、`vite.config.ts`への補助Worker追加は不要です。API側の各環境で`ALLOWED_GAME_IDS`を設定し、管理画面の起動ログで両方のService Bindingが`connected`になっていることを確認します。

接続やtokenが未設定の場合はAPIが503を返し、起動していない接続先や上流エラーは取得失敗として表示します。通常の開発・本番で代替Workerやテスト用集計を挿入しません。独立した管理画面のWorkerテストだけが、無関係な統計呼び出しに503を返すテスト用Workerを登録します。
