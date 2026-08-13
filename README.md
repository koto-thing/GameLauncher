# PandD GameLauncher

PandDゲームランチャー、ゲーム受入ツール、公開制御Webアプリを管理するモノレポです。

## ディレクトリ

- `client/` — C++ / Qt製ゲームランチャー
- `apps/intake-uploader/` — Qt for Python製のゲーム受入uploader
- `apps/control-plane/` — Cloudflare上の申請・承認Webアプリ
- `contracts/` — 各アプリで共有するJSON Schema
- `publisher/` — 検証済みartifactの公開処理
- `installer/` — ゲームランチャーのインストーラー
- `backend/` — ランチャーが読む公開コンテンツ
- `scripts/` — CI・運用・ローカル起動スクリプト
- `docs/` — 設計と運用手順

ローカル生成物は `build/`、`cmake-build-*/`、`local-test/` に出力され、Git管理には含めません。

## デプロイ方法

日常のゲーム公開は[メンテナンスWebアプリ](https://pandd-deployment-control-plane.gotoukenta62.workers.dev/)だけで進めます。

1. Webアプリから `PandDIntakeUploader.exe` をダウンロードして起動する
2. ゲームのフォルダー、起動exe、バージョン、画像を選び、intakeへのアップロードを完了する
3. uploaderが保存した `*.pandd-artifact.json` をWebアプリの「新しい申請」で選ぶ
4. Staging申請の承認者を指名し、別のGitHubアカウントで承認して「STAGINGへ実行」を押す
5. Staging版の起動・表示・更新・保存データを確認する
6. 成功したStagingカードの「Production申請を作成」を押す
7. Production申請を別アカウントで承認し、「PRODUCTIONへ実行」を押す
8. `https://downloads.koto-thing.com/` 配下のカタログとゲーム起動を確認する

Productionは成功したStagingと同じArtifact ID・SHA-256だけを、Staging成功から7日以内に進められます。秘密鍵やR2認証情報はWeb画面へ入力しません。
非公開のゲームZIPはprivate intake R2から保護された実行jobへ直接渡し、GitHub ActionsのArtifactには保存しません。

### 初回だけ必要な管理者設定

GitHubのRepository Variable `DEPLOYMENT_CONTROL_PLANE_URL`に次を設定します。

```text
https://pandd-deployment-control-plane.gotoukenta62.workers.dev
```

GitHub Environmentsに`staging`と`production`を作り、どちらにもRequired reviewersを設定して自己承認を禁止します。それぞれに環境専用の次のSecretsを登録します。StagingとProductionで値を共有しないでください。

```text
MANIFEST_PRIVATE_KEY_PEM
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ENDPOINT
```

ランチャー本体もGitHub Actionsから公開する場合は、`production` Environmentへ次も登録します。

```text
MANIFEST_PUBLIC_KEY_BASE64
R2_BUCKET=pandd-launcher-production
```

Cloudflareには`pandd-launcher-staging`と`pandd-launcher-production`を別々に用意し、Productionの`downloads.koto-thing.com`を有効にします。設定とStaging実行試験が終わるまで、[wrangler.jsonc](apps/control-plane/wrangler.jsonc)の次の値は`false`のままにします。

```json
"STAGING_DISPATCH_ENABLED": "false",
"PRODUCTION_DISPATCH_ENABLED": "false"
```

Stagingの設定確認後に`STAGING_DISPATCH_ENABLED`だけを`true`にしてWebアプリを再公開します。Stagingの一連の試験に成功し、ProductionのRequired reviewers・専用鍵・専用R2を再確認した後にだけ`PRODUCTION_DISPATCH_ENABLED`を`true`にします。

Webアプリ自体の再公開は次で行います。

```powershell
Set-Location apps\control-plane
npm ci
npm test
npm run deploy:cloudflare
```

ランチャー本体はゲーム公開とは別です。レビュー済みのmaster上でバージョンを揃え、`v<major>.<minor>.<patch>`タグをpushすると、`Publish Windows production` workflowがビルド・検証・R2公開・GitHub Release作成を行います。詳細は[PRODUCTION_SETUP.md](docs/PRODUCTION_SETUP.md)を参照してください。
