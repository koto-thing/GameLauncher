# ロリポップ公開準備記録

**2026-09-06に本番デプロイ完了。現在のURL・配置・検証結果は [デプロイ結果](deployment-2026-09-06.md) を参照。以下は公開前に使用したチェックリストの記録で、SSL待ちやFTP未接続という状態は解消済み。**

2026-09-06、所有者の依頼によりCloudflare Pagesの `pandd-music-preview` を削除し、Pages一覧から消えたことを確認した。仮公開専用の生成・検証スクリプトと設定も廃止した。既存のcontrol-plane、MusicのPHP実装、ローカルデータは維持する。

ロリポップへの本番アップロード・DB変更・管理Worker更新はまだ行わない。所有者からSSL有効化の連絡を受けてから、HTTPSと配置条件を確認する。公開・非公開化の通常操作には人の承認を追加しない。

## 決まっている値

| 項目 | 値 |
|---|---|
| 公開URL | `https://pandd-music.koto-thing.com/` |
| 公開FTPフォルダ | `/pandd-music`（FTPログイン後のパスを転送時に確認） |
| MUSIC_PUBLIC_URL | `https://pandd-music.koto-thing.com/` |
| MUSIC_BRIDGE_URL | `https://pandd-music.koto-thing.com/bridge.php` |
| MUSIC_ENVIRONMENT | `production`（PHPと一致） |
| MUSIC_BRIDGE_KEY_ID | `primary` |
| PHP basePath / bridgePath | 空文字 / `/bridge.php` |
| MUSIC_ENABLED | 準備中は `false`。HTTPS・DB・権限・連携確認後に有効化 |

サブドメインのルート配信なので、公開URLに `/pandd-music` を追加しない。

## 配布物

`apps/music`で `npm run package:rental`。出力は `build/rental-package-*/`。Windowsでnpm.ps1が利用できない場合は `node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run package:rental`。

```text
music/public/              → 公開FTPフォルダ /pandd-music の中身
music/src/                 → PHPアプリ。下の配置条件を先に確認
music/vendor/              → Composer本番依存を同梱
music/config/policy.json   → 共有調整値
music/config/config.example.php → 非公開local.php作成用テンプレート
music/scripts/             → CLI環境確認・初期化・整合性確認
PACKAGE.json               → 配布情報。公開フォルダに置かない
```

配布物には下書き・ローカルDB・秘密設定・管理bundle・Pagesの静的デモ音源を含めない。GitHubの `Music validation` も成功時に `music-rental-package` artifactを生成する。手動実行は検証と配布物作成だけで、FTP転送はしない。`.htaccess` をartifactから落とさない設定を含む。

## アップロード前に確定すること

1. **サーバー内の実パスと非公開領域。** `/pandd-music` はFTP上のフォルダ名であり、PHP設定用の絶対パスとは限らない。現在のPHP入口は `../src/bootstrap.php` を参照するため、公開フォルダの親にsrc/vendor/configを置けるか、かつ親ドメイン・初期ドメインを含む全URLから保護できるかを確認する。確認前に親フォルダへコピーしない。成立しなければ、実際の非公開アプリ領域に合わせて入口を調整してから配布する。
2. **storageRoot。** 下書き・音源原本・公開状態・受領記録を置く非公開の書込み可能領域。同一filesystemでロックとatomic renameが機能することを確認する。Webから見える場所を便宜的に指定しない。
3. **専用連携鍵。** `MUSIC_BRIDGE_SECRET` とPHPの `keys['primary']` を同じ32文字以上のランダム鍵にする。FTPパスワードを流用せず、Git・公開物・ログへ出さない。
4. **共通認証と権限。** 既存GitHub AppのCallbackと `GITHUB_CALLBACK_URL` の一致を確認。control-planeの現在のURLを使う場合は `https://pandd-deployment-control-plane.gotoukenta62.workers.dev/api/auth/github/callback`。既存DBへの0004_music.sql追加適用と、初期Music運営のGitHub数値IDを確認。ゲーム権限は付与しない。
5. **連絡窓口。** PHPの `contactUrl` に実際の窓口を設定する。

FTP転送に使うGitHub Secrets名は `FTP_SERVER`・`FTP_USERNAME`・`FTP_PASSWORD`。以前、登録名の存在を確認済みだが接続は未検証。`PUBLIC_FOLDER` の値は読み出せないため `/pandd-music` と一致すると仮定しない。`OVERWRITE` を削除・全同期の許可として使用しない。**FTP配布処理は未接続であり、公開・非公開の配置境界を確定してから実装・実行する。**

## サーバーの確認

PHP 8.2以上（ローカル検証は8.4）、fileinfo、GDのJPEG/PNG/WebP、memory_limit 256M以上を起点に確認する。非公開アプリディレクトリで次を実行できる。

```sh
php scripts/check-environment.php
```

これは設定や鍵を表示しないCLI専用の確認で、データを書き換えない。失敗は終了コード1。CLIとWebのPHP設定は異なることがあるため、合格だけでWeb配信可能とは判定しない。SSHが利用できない場合、このスクリプトを公開URLへ移すのではなく、提供される実行手段を確認する。

管理画面の `upload_max_filesize=20M` はそのままでよい。音源はraw PUT受信のため、この値だけで可否を決めない。64MiB転送・Webサーバー/WAF/PHPのtimeout、Apache rewrite/headers、全ドメインからの私有領域アクセス拒否は実サーバーで別に検証する。

SSL連絡後は、証明書検証を無効化せずHTTPSを確認 → 配置境界と転送計画の確定 → 必要設定・配布 → 初期化 → 登録・下書き保護・公開・再生・非公開化・失敗再試行を確認する。最後に公開サイトの通信記録から通常閲覧・再生でWorkersを呼ばないことを確認する。

既存の詳細手順・バックアップ方針は [operations.md](operations.md) を参照。

## 今回のローカル確認結果

- 配布物: `apps/music/build/rental-package-9WyjhJ`。
- TypeScript型チェック、Lint、アーキテクチャ・コメント検査、公開ビルドの境界検査は合格。
- 配布物の `.htaccess` を確認。local.php、環境秘密ファイル、DB、鍵、Pagesデモ音源の混入なし。
- 同梱のcheck-environment.phpをPHP 8.4.25・fileinfo/GD・256Mで実行し合格。128Mでは終了コード1となることも確認。PHP構文検査合格。
- 既存ゲーム・Intake・Actions・権限のコードは今回変更せず、回帰テスト一式は再実行していない。ロリポップ実機・FTP接続・HTTPS・実公開フローは未検証。
