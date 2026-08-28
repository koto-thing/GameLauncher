# PandD Platform

PandDのランチャー、配信、運営機能と、今後のストア・コミュニティを管理するモノレポです。

開発・テスト・デプロイ・APIリファレンスは

* 右のGithub Pages
* [PandD Platform Docs](https://koto-thing.github.io/GameLauncher/)  

で確認できます。

システムは「一般利用者」「配信」「運営」の3つの信頼環境に分離し、

* Identity
* Catalog
* Commerce
* Entitlements
* Community
* Moderation
* Notifications

の業務モジュールを境界として開発しています。

セキュリティ上の問題は公開 Issue ではなく [セキュリティポリシー](SECURITY.md) の非公開窓口へ報告してください。  
コード署名の運用と SignPath Foundation への申請準備は [Code signing policy](docs/CODE_SIGNING_POLICY.md) に記載しています。  

## GameLauncherについて
### Staging版GmaeLauncher

これは、配布するゲームが正しくインストール・ダウンロードできるかどうかの最終確認するためのGameLauncherになります。

そのため、これを使用するのは、運営メンバーのみになります。

`Publish Windows staging` ワークフローを起動すると、ReleaseにStaging版のゲームランチャーが作成されます。

### Production版GameLauncher

これは、一般にゲームを公開するための最終確認用のGameLauncherになります。

以下のようなコマンドを打つと、自動的にビルドが走ります。  
バージョン名は適宜変更してください。
```bash
git tag -a v1.0.2 -m "Release v1.0.2"
git push origin v1.0.2
```

## ゲームのアップロード方法

ゲームは、

https://pandd-deployment-control-plane.gotoukenta62.workers.dev/

にてアップロードできます。

このレポジトリの管理者と管理者が指定したユーザー（モデレーター）のみがアップロードできるようになっています。  
モデレーターがアップロードする場合、確認のためほかのモデレータの１週間以内の承認が必要になります。

## Live2Dモデルについて

Live2Dモデルを個別のゲーム画面でうごかすことができます。
`apps/launcher/resources/live2d/<モデル名>/`にモデル一式を配置してください。
ただし、`.model3.json`から参照されるテクスチャなどはその相対位置を維持するようにしてください。

model.jsonにゲームとの対応を入力してください
```json
{
  "games": {
    "対象のgameId": {
      "model": "モデル名/character.model3.json",
      "idleGroup": "Idle",
      "centerX": 0.65,
      "centerY": 0.5,
      "scale": 1.0
    }
  }
}
```

## ディレクトリ

- `apps/launcher/` — C++ / Qt製ゲームランチャー
- `apps/intake-uploader/` — Qt for Python製のゲーム受入uploader
- `apps/admin-web/` — Cloudflare上の申請・承認Webアプリ
- `apps/store-web/` — 一般利用者向けストア（実装予定）
- `apps/community-web/` — 一般利用者向けコミュニティ（実装予定）
- `services/platform-api/` — 一般利用者向けAPI（実装予定）
- `modules/` — 業務モジュールの責務と依存規則
- `packages/contracts/` — 各アプリで共有するJSON Schema
- `services/deployment_publisher/` — 検証済みartifactの公開処理
- `apps/launcher/installer/` — ゲームランチャーのインストーラー
- `services/distribution-content/` — ランチャーが読む公開コンテンツ
- `infrastructure/` — 信頼環境とCloudflareリソースの所有境界
- `scripts/` — CI・運用・ローカル起動スクリプト
- `docs/` — 設計と運用手順

ローカル生成物は `build/`、`cmake-build-*/`、`local-test/` に出力され、Git管理には含めません。