# 起動・配置・運用

現在の本番URL・配置・検証結果は [ロリポップデプロイ結果](deployment-2026-09-06.md) を参照。Musicの仮公開Pagesは削除済みで、ロリポップのHTTPS配信と既存control-planeのMusic管理が稼働している。

## ローカルで登録から聴取まで

Node 24、npm、PHP 8.2以上（fileinfo・GD、JPEG/PNG/WebP対応）、Composer 2が必要。今回の確認環境はWindows、Node 24.18.0、PHP 8.4.25、getID3 1.9.25。PHPは`PHP_BIN`で実行ファイルを指定できる。Windowsの今回のworkspaceには`build/music-tools/php/php.exe`を配置済みだが、配布ソースには含めない。

リポジトリrootから初回準備：

```sh
npm --prefix apps/admin-web ci
npm --prefix apps/music ci
composer --working-dir=server/music install --no-dev --prefer-dist
cd apps/music
npm run dev
```

Windowsでnpm.ps1が壊れたユーザー環境では`node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run dev`で同じスクリプトを実行できる。PHP拡張は自分のphp.iniで有効化する。今回のWindows用ローカル起動はPHP実行ファイル隣の`ext`からfileinfo/GDを読み込む。

- 管理：[http://127.0.0.1:8788/music](http://127.0.0.1:8788/music)
- 一般公開：[http://127.0.0.1:8088](http://127.0.0.1:8088)
- 既存ゲーム画面：[http://127.0.0.1:8788](http://127.0.0.1:8788)

起動時に公開・管理ビルド、既存migration＋0004のローカル適用、明示Musicアカウント登録、HTTP APIによる2作品6曲のデモseedを行う。localhostのみで待受、Actions dispatchはOFF、remote bindingsはOFF。既存wrangler.jsoncの本番DB名・ID・INTAKEをこの起動に流用しない。

| ローカルアカウント | 権限 |
|---|---|
| music-admin / 900001 | Music運営。ゲーム権限なし |
| music-a / 900002 | DEMO 1担当 |
| music-b / 900003 | DEMO 2担当 |
| outsider / 900004 | 本人確認だけ。未割当 |
| admin / 1001 | 既存ゲームAdmin。Music運営ではない |
| maintainer・reviewer | 既存ゲームのローカル担当・承認者 |

管理画面のローカルリンクでmusic-aを選び、担当作品→曲を追加→音源・画像・クレジット→下書き保存→ループ設定・試聴→利用権確認→下書き保存→「この曲を公開する」。公開サイトで画像付きの聴取・シーク・区間リピートができる。作品作成・担当者割当・広告はmusic-admin。未保存内容の公開はさせず、下書き保存と公開反映を分ける。

Ctrl+Cで停止。データは`apps/admin-web/build/music-local/state`と`apps/music/build/local-rental/private`に保持し、自動削除しない。ローカル連携鍵・session鍵は起動ごとに作り直すため再ログインする。E2Eは新しい`apps/admin-web/build/music-e2e-*`へ隔離し、開発データを変更しない。同じ8088/8788ポートを使うため、devを停止してから実行する。

```sh
npm run check
npm run browsers:install
npm run test:e2e
npm run test:public
npm run package:rental
```

`test:e2e`は実vinext・D1・PHPを起動し、終了時に所有するプロセスを停止する。環境によってWranglerのユーザー開発レジストリへの書込み許可が必要。`test:public`は公開後にworkerdを停止してPHP単独のブラウザー通信記録とCPU/heap測定を作る。ゲーム回帰は`npm --prefix apps/admin-web test`。

## 本番配置の準備（未実行）

`npm run package:rental`の出力は`apps/music/build/rental-package-*/music/`。static＋PHP public、src、vendor、設定テンプレート、運用CLI、composer.lockを含み、local.php、デモ認証、test router、Music管理bundle、秘密、私有データは含まない。

```text
private app directory/music/
  public/        ← このディレクトリだけをMusicのdocument rootにする
  src/
  vendor/
  config/local.php
  scripts/
private data directory/  ← storageRoot。document rootの外・同一filesystem
```

レンタルサーバーのdocument rootを選べない場合も、公開rootへコピーするのは`public/`の内容だけ。PHP入口からの`../src/bootstrap.php`参照が成立する親ディレクトリへsrc/vendor/configを置く。アプリ全体をpublic_htmlへ置く構成にしない。各配置物とバックアップはdirectory listingを許可しない。

Apache 2.4のmod_rewrite、AllowOverride、mod_headers、Options -Indexes/-MultiViews、`[END]`対応を確認する。`.htaccess`はAPIエラーをSPAの200へ書き換えず、作品/曲/aboutの直リンクのみindex.htmlへ向ける。nginx等では同等設定を用意する。今回の実行はPHP内蔵test routerであり、実レンタルサーバーのApache設定は未検証。

PHP 8.2+、fileinfo/GD/getID3、私有領域へのwrite、flock/atomic rename/fsyncの動作を確認。storageは同一filesystem。PHP実行権限は必要な私有ディレクトリだけ。memory_limitは少なくとも256Mを起点に最大画像のGDデコードを実測する。HTTP request bodyの上限・Webサーバー/WAF/proxy/PHPのtimeoutは64MiB raw PUT転送と検証時間を許容する値にする。PHP post_max_size等とホスト固有制限も確認する。音源の自動変換はしない。

config.example.phpをdocument root外のconfig/local.phpへ複製し、environment、documentRoot、storageRoot、bridgePath、basePath、keys、contactUrlを設定する。`MUSIC_CONFIG`環境変数で別の非公開設定を指定してもよい。連携鍵は32文字以上のランダムな専用鍵。設定テンプレートの文字列をそのまま使わない。

初回のみ`php scripts/initialize.php`。既存current.jsonの破損を再初期化で隠さず復旧する。`php scripts/verify-storage.php`で整合性を検証する。subdirectory配信の場合は公開build時の`MUSIC_BASE_PATH=/music/`、PHP basePath=`/music`、bridgePath=`/music/bridge.php`、Worker URL設定を揃える（subdirectoryの実Apache配信は未検証）。

## 既存control-planeに必要な設定

本番更新前に既存DBへ0004_music.sqlを既存migration手順で追加適用する。既存テーブルや過去migrationを再作成しない。Music未有効の間に追加スキーマを先に用意できる。既存control-plane buildは管理bundleを自動生成するため、両方のnpm依存をインストールしてから行う。

| 値 | 内容 |
|---|---|
| GITHUB_CALLBACK_URL | 既存Appに登録した固定control-plane Callback。共通認証の更新前に必須 |
| MUSIC_ENABLED | `true`で有効。未設定/falseではMusicだけ停止 |
| MUSIC_ENVIRONMENT | staging / production。PHPと一致 |
| MUSIC_PUBLIC_URL | レンタルサーバーの公開トップURL。末尾`/` |
| MUSIC_BRIDGE_URL | 同サーバーの固定HTTPS bridge.php URL |
| MUSIC_BRIDGE_KEY_ID | PHP keysのキー名。初期primary |
| MUSIC_BRIDGE_SECRET | PHPと同じ専用秘密。Worker Secretとして登録 |
| SESSION_SECRET等 | 既存の共通認証設定を継続。別Music OAuth設定は不要 |

Music運営の初期登録は本人の数値IDとログイン名を確認し、DB管理者が次の形で明示実行する。例の値を本番実在者とみなさない。

```sql
INSERT INTO music_accounts(id, login, admin)
VALUES ('確認済みGitHub数値ID', '確認済みlogin', 1);
```

以後の作品担当はMusic運営画面からGitHub数値IDで割り当てる。解除は次のMusic APIから反映する。全Collaboratorへの一括Music権限付与は行わない。

HTTPS証明書、公開origin、CORS不要の同一origin配信、Cookie host-onlyを確認。DNSはレンタルサーバーへ直接向け、Cloudflareを使う場合も公開MusicホストにWorker Route/Pages/画像変換を通さない。media/APIのCDNキャッシュは無効。広告は自前画像＋HTTPSリンクのみ、初期OFF。実広告サービス・解析SDKへの通信は追加していない。

## 停止・障害・整理

管理の「公開処理」で結果不明を見た場合、同じ操作を状態確認・再試行する。手動でD1だけを公開済みへ書き換えない。未確定中は同scopeの次の公開をブロックする。署名鍵・時計・容量・PHPの権限・HTTPS経路を確認する。

緊急の公開停止は私有storageRootに`STOP`ファイルを作ると全public API/mediaが503になる。管理側が停止していても使用可。個別停止はMusic運営の作品停止、個別取り下げは担当者の非公開操作。安全確認後だけSTOPを解除する。

`php scripts/cleanup.php`はdry-run。`--apply`で24時間超の受信一時ファイルだけを整理する。進行中uploadは専用lockで保護する。公開切替時は実行時間上限を越えて5分経過した現在版以外のsnapshotを削除し、receiptはscopeごとの最新結果・全体1024件まで保持する。assets、D1下書き、保留操作、backupは自動削除しない。不要な確定素材や履歴の削除は参照・保存要件を別途棚卸しして承認後に行う。

## バックアップ・復元

1. 管理操作を停止し、prepared/sending/unknownを照合して可能な限りappliedへ解決する。結果不明が残る場合はそれも含めて保存する。
2. 既存D1を既存のバックアップ手順でexport。music_*のdraft、assets、uploads、publications、delivery、accounts、memberships、auditを欠落させない。
3. 私有storageのassets、snapshots、current.json、initializedを同じ復旧点として保存し、設定/鍵は別の秘密管理で保管する。Webからbackupへアクセスさせない。公開static/PHPのリリース版とpolicy digestも記録する。
4. 復元時はまずSTOP、Music管理OFF。追加スキーマを壊さず、対応するD1とprivate storageを復旧する。`verify-storage.php`で全素材digest・サイズ・現在参照を検証する。
5. PHPのscope revision/receiptとD1のmusic_delivery/music_publicationsを照合し、結果不明は同一操作のstatusで解決する。D1だけ過去へ戻して現在PHPに新操作を送ると競合するため、手動でrevisionを緩めない。
6. private直URL拒否、取下げ素材のGET/HEAD/Range拒否、管理権限、公開通信先を検証してから公開・管理を再開する。

D1とPHPには分散トランザクションがない。整合した復旧点が取れない場合は停止状態を保ち、保存したreceiptと不変操作を基に照合する。本番バックアップ製品との結合・本番復元訓練は未検証。

## 切戻し

Music管理を止めるにはMUSIC_ENABLED=false。既に公開したPHPサイトは独立して利用可能。公開自体を止める場合はSTOPを併用する。既存ゲーム用DB、Intake、Actions、bindingを変更しない。追加music_*テーブルを削除せず、旧アプリへ戻す場合も現在PHPのscope/receipt/素材を保持する。鍵漏洩時はPHPから該当鍵を外してbridgeを失効し、公開読取とゲーム管理は維持する。共通認証を旧版へ戻す場合のCookie形式は互換化せず再ログインする。

本番公開、DNS変更、契約、既存データ削除、実Actionsの起動は所有者の承認後に別途実施する。今回これらは実行していない。
