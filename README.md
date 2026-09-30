# PandD Platform

PandDのランチャー、配信、運営機能と、今後のストア・コミュニティを管理するモノレポです。

開発・テスト・デプロイ・APIリファレンスは

* 右のGithub Pages
* [PandD Platform Docs](https://koto-thing.github.io/GameLauncher/)  

で確認できます。

DocsのWeb編集機能・Cloudflare移行の設定と運用は [Docs Web Editor](apps/docs-worker/README.md) を参照してください。本番App・Secrets・DNSの設定は所有者による作業です。

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

## VRMモデルについて

ゲーム詳細画面にはLive2Dに加えてVRM 0.x／1.0モデルを表示できます。
`apps/launcher/resources/vrm/<モデル名>/` に `.vrm` を配置し、
`apps/launcher/resources/vrm/models.json` にゲームとの対応を登録してください。
モデルはテクスチャを内包する128 MiB以下のVRMファイルを使用します。

```json
{
  "games": {
    "対象のgameId": {
      "model": "モデル名/character.vrm",
      "centerX": 0.65,
      "centerY": 0.5,
      "scale": 1.0
    }
  }
}
```

`centerX`／`centerY` は画面左上を0、右下を1とするモデル中心位置です。
`scale` は0.1〜4.0で、1.0ならモデル全体が収まります。
同じゲームにはLive2DとVRMのどちらか一方を登録してください。
VRMは自然な腕の姿勢と簡単な呼吸・まばたきで表示し、モデルに含まれる揺れ物を更新します。
別ファイルのモーション再生や利用者によるモデルインポートは提供しません。
非表示・最小化・ゲーム実行中はアニメーションを停止します。
モデルの配布条件を確認したうえで同梱してください。サンプルモデルは製品には同梱していません。

ビルドには既存のQtに加え、Qt WebEngine、Qt WebChannel、Qt PositioningとNode.js 24が必要です。
`apps/launcher/vrm-viewer/package-lock.json` の固定依存関係をCMakeが取得し、
Three.jsとthree-vrmをローカルリソースにバンドルするため、実行時の通信は不要です。
Qt WebEngineのランタイム、リソース、ロケールもQtのデプロイ処理で配布します。

モデルなしでの検証は `ctest` の `VrmTests`／`VrmViewerTests` で実行できます。
描画確認には `/vrm/test.vrm` を含むテスト用バイナリRCCを作り、
`VrmPreview <テスト用.rcc>` を実行してください。正常描画時は `vrm-preview.png` を保存します。

実装は [three-vrm](https://github.com/pixiv/three-vrm) と
[Qt WebEngine](https://doc.qt.io/qt-6/qtwebengine-index.html) を使用しています。

## ディレクトリ

- `apps/launcher/` — C++ / Qt製ゲームランチャー
- `apps/launcher-download-web/` — [GameLauncher配布ページ](apps/launcher-download-web/README.md)（独立した静的サイト）
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
