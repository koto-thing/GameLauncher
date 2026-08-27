# ローカル開発環境

PandDは1つのモノレポです。Launcher、Admin Web、公開処理は同じリポジトリにありますが、実行権限と資格情報は共有しません。

## 必要なツール

| 対象 | 主な要件 |
| --- | --- |
| Launcher | CMake 3.24以上、C++20対応コンパイラー、Qt 6.10.2、vcpkg、Python 3.13以上 |
| Windows Launcher | Visual Studio、MSVC v143 x64、Qtの対応するMSVCバイナリー |
| Live2D | レビュー済みCubism Native SDK 5-r.5。SDK本体はリポジトリへcommitしない |
| Admin Web / Docs | Node.js 22.13以上、npm 10以上 |
| API生成 | Doxygen、OpenAPI 3.1 validator（Docs packageに含む） |

開発者固有のパス、SDKの場所、資格情報は環境変数またはGit管理外のローカル設定で指定します。`.env`、秘密鍵、R2資格情報はcommitしません。

## ディレクトリ構成

```text
apps/
  admin-web/             運営用Control Plane
  launcher/              Qt / C++ LauncherとInstaller
  intake-uploader/       Legacyデスクトップ入稿ツール
  store-web/             将来領域（READMEのみ）
  community-web/         将来領域（READMEのみ）
services/
  deployment_publisher/  検証・署名・R2公開
  distribution-content/  Launcher向け静的コンテンツ
  platform-api/          将来領域（READMEのみ）
packages/contracts/      canonical JSON SchemaとOpenAPI
infrastructure/          信頼境界の機械可読な正本
docs/                    このサイトの原本
```

詳しいコマンドとCLion設定は [Development](../DEVELOPMENT.md) を参照してください。

## 最初の検証

変更対象に応じて、[Launcher開発](./launcher-development.md) または [Admin Web開発](./admin-web-development.md) の最小テストを先に成功させます。その後に配信や公開へ進みます。
