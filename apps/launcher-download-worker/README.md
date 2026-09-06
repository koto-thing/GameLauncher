# 最新版Windowsインストーラーの固定URL

`https://downloads.koto-thing.com/download/windows` を、検証済みの最新版インストーラーへ302転送します。
WorkerはR2の `v1/launcher/downloads/windows/x86_64/latest.json` を直接読み、インストーラーのサイズ・SHA-256メタデータが一致する場合だけ転送します。転送先は既存の本番ドメインとWindows用パスに限定します。URL引数で転送先を変更できません。

GET/HEADのみ対応。未公開・不正な情報・R2障害時は503、他パスは404、他メソッドは405。全応答は`Cache-Control: no-store`と`CDN-Cache-Control: no-store`です。固定URLを強制キャッシュするCache Ruleは設定しないでください。インストーラー本体は既存のバージョン別R2オブジェクトから配信されます。

## リリース処理

既存の `.github/workflows/release.yml` の本番publishジョブに組み込み済みです。

1. publishジョブ全体を共通concurrency groupで直列化（途中キャンセルなし）。
2. 既存の最新版より古いタグは、IFW更新先のアップロード前に拒否。
3. 既存処理でバージョン別ファイルとIFWリポジトリをアップロードし検証。
4. GitHub Release公開まで成功後、`scripts/release/promote_installer.py`を実行。
5. 公開URLからインストーラーをストリーム取得してローカル成果物・SHA-256 sidecarと照合し、公開IFW `Updates.xml` の `org.pandd.launcher` バージョンを確認。
6. 全検証成功後にだけ最新版JSONをR2へ書き、読み戻して照合。

失敗時はダウンロードポインターを切り替えません。ただし既存IFWリポジトリ自体は別の更新処理です。古いオンラインインストーラーも同じIFW URLを参照するため、本体の更新タイミングは固定URLの切り替えとは独立です。IFWの複数オブジェクトを一括ロールバックする機能はこの変更には含めません。

リリースの検証直後に切り替えるため、初回を除きサイトの再ビルドは不要です。Mac/Linuxは今回の固定窓口に含めず、サイトでは引き続き準備中です。

## ローカル検証

このディレクトリで `npm ci` → `npm test` → `npm run check`。
リポジトリルートで `python -m unittest scripts.tests.test_promote_installer scripts.tests.test_desktop_release_workflow`。
Miniflare/workerdのローカルR2で、旧版から新版への切り替え、HEAD、キャッシュ禁止、欠損・不正ポインター、ハッシュ不一致、別パスとPOST拒否を確認します。
互換日は既存のインストール済みworkerdで実行可能な2026-09-02を使用しています。

## 所有者の本番公開手順

実装時点ではWorkerの本番デプロイ、ポインターの書き込み、サイトリンクの切り替えは未実施です。既存サイトの有効なGitHubリンクは維持しています。

1. この変更をレビューして既定ブランチへ反映。
2. 本番R2 `pandd-launcher-production` と既存独自ドメインを使用し、このディレクトリで `npm ci` と `npm run deploy`。ルートは `/download/windows*` のみです。既存 `/v1/*` の配信設定を変更しないでください。
3. 通常の本番タグリリースを実行するとポインターが生成されます。初回に既存版を使う場合は、正式リリースのEXEとSHA-256 sidecarを取得し、R2公開物と一致することを次のコマンドで検証・登録します。秘密情報は既存の本番Environmentから渡します。

```powershell
python -m scripts.release.promote_installer --version 1.0.5 --artifact '検証対象/PandD-Game-Launcher-Online-Installer.exe' --endpoint $env:R2_ENDPOINT --bucket $env:R2_BUCKET
```

上記のバージョンは本番IFWで2026-09-06に確認した値です。実行時に公開されている正式版を指定してください。並行実行せず、通常のリリースジョブが停止している状態で実行します。

4. `apps/launcher-download-web` で次を実行。固定URLの302・転送先・公開ファイルのサイズとSHA-256を検証できた場合だけ、`site.config.ts`のWindowsリンクを書き換えます。検証失敗時はファイルを変更しません。

```powershell
node scripts/activate-cloudflare.ts
npm run check
```

5. 変更された設定をコミットし、サイトの`dist/`を公開。ブラウザーからWindowsボタンで実際にダウンロードし、対象Windows端末でインストールを確認します。

## 障害時

欠損・整合性異常では503で停止し、別OSやGitHubへの自動代替はしません。最新JSONと実体を調査してください。旧版へ戻す場合はIFWリポジトリの復旧も合わせて行い、以前に保存した検証済みポインターを本番の保護された作業として復元します。通常の公開コマンドはダウングレードを拒否します。

参照: [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[Worker Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)。
