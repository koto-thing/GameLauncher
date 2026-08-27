# Admin Web公開

Admin WebはCloudflare Workersへデプロイします。D1 migration、R2 CORS、GitHub OAuth/OIDC、dispatch gateを確認してから公開します。

```powershell
Set-Location apps/admin-web
npm ci
npm run lint
npm test
npm run deploy:cloudflare
```

StagingとProductionのdispatchは個別に有効化します。最初にStagingだけを有効化して全フローを確認し、ProductionのRequired reviewers、専用鍵、専用R2を再確認した後にだけProductionを有効化します。

Cloudflareへ登録する値は外部設定として管理し、リポジトリ、Docs、GitHub Actions artifactへ含めません。具体的なBinding名と設定順序は [Admin Web README](https://github.com/koto-thing/GameLauncher/blob/master/apps/admin-web/README.md) と [Production setup](../PRODUCTION_SETUP.md) を参照してください。
