# PandD Music

既存GameLauncher control-planeで音楽を管理し、一般公開サイト・音源・画像・公開情報をレンタルサーバーから配信する初期版です。通常の閲覧・再生・区間ループはWorkersへ接続しません。

ローカルでは実vinext＋D1＋PHPを接続し、2作品6曲の自作トーンで検証します。本番公開・DNS変更・実GitHub App接続は実施していません。

## 起動

Node 24、PHP 8.2+（fileinfo/GD）、Composer 2を用意してください。

## 公開フロントエンドのデプロイ

`apps/music/.env` に `FTP_SERVER`（ホスト名、任意のポート）、`FTP_USERNAME`、`FTP_PASSWORD`、`PUBLIC_FOLDER`（FTPログイン先からの公開ディレクトリ）、`OVERWRITE=true` を設定し、Node 24以降とcurlを用意してください。

```sh
cd apps/music
npm run deploy
```

`.env` を読み込み、公開サイトのビルドと配布物検査に成功した後、証明書検証付きのFTPSで転送します。既存のシェル環境変数がある場合はそちらが優先されます。アセットを先に、`index.html` を最後に転送します。転送失敗時は停止するので、原因を解消して同じコマンドを再実行してください。

対象は公開フロントエンドのみです。PHP本体・公開PHP入口・サーバー設定・音源データ・管理Workerは更新せず、リモートの既存ファイルも削除しません。PHP等の配置手順は運用ドキュメントを参照してください。npmの正式な実行構文は `npm run deploy` です。

```sh
npm --prefix apps/admin-web ci
npm --prefix apps/music ci
composer --working-dir=server/music install --no-dev
cd apps/music
npm run dev
```

管理は http://127.0.0.1:8788/music 、公開サイトは http://127.0.0.1:8088 。Music運営はmusic-admin、担当者はmusic-a/music-b。既存ゲーム用adminとMusicの権限は独立しています。

- [起動・設定・配置・バックアップ・切戻し](../../docs/music/operations.md)
- [構成と再利用した実装](../../docs/music/architecture.md)
- [認証・権限](../../docs/music/permissions.md)
- [署名・公開同期・再試行](../../docs/music/bridge-publication.md)
- [調整値](../../docs/music/parameter-guide.md)
- [試験結果と未検証事項](../../docs/music/test-report.md)
- [コマンドコードの仕様・利用・既存曲への適用・実測結果](../../docs/music/command-code.md)

`npm run check`、`npm run test:e2e`、`npm run test:public`で検証し、`npm run package:rental`で配布物を準備します。devとE2Eは同じポートを使うため同時起動しないでください。
