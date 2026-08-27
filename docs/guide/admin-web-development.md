# Admin Web開発

Admin Webは `apps/admin-web` にあるCloudflare Workers向けVinextアプリです。Deployment DBと非公開Intakeだけを扱う運営環境であり、一般ユーザーのPlatform DBや配信先R2の直接書き込み権限を持ちません。

## セットアップ

```powershell
Set-Location apps/admin-web
npm ci
npm run dev
```

ローカル開発用認証はlocalhostかつ明示的に有効化した場合だけ利用できます。`.dev.vars` の値、OAuth secret、session secretを文書やcommitへ含めません。

## 検証

```powershell
npm audit
npm run lint
npm test
```

`npm test` はproduction build後にNodeテストを実行します。Schema validatorはbuild/test前に `packages/contracts/schemas` のcanonical schemaから生成されます。

API routeの正本は `apps/admin-web/app/api` です。認証、Origin判定、上限値を変えた場合は [Admin HTTP API](../reference/admin-api.md) とOpenAPIも同じ変更で更新してください。
