# PandD GameLauncher 配布ページ

既存ランチャー・ストア・認証・ゲーム配信基盤から独立した、1画面の静的サイトです。
既存のPandDロゴをヘッダー左上に配置し、中央にはPlay and Discoverタイトル（直立のサンセリフ体、PとDをピンクで強調）と「遊び心が、動き出す。」のキャッチコピー、Windows → Mac → Linuxの3枠を配置します。
背景には静的な横線ノイズとコントローラー・十字キーの線画を重ね、ピンク・チャコール・白で統一しています。下部に© PandDフッターを表示します。背景動画は1本のみで、ページ内の一時停止・再生ボタンはありません。動画未設定時はチャコール背景で成立します。

## 開発・ビルド・テスト

Node.js 24 LTSとnpmを使用します。Vite / TypeScript / Playwrightは既存の`apps/music`と同じ版を採用し、
このアプリ自身の`package-lock.json`で固定しています。本番のサーバー処理・実行時依存はありません。

```sh
cd apps/launcher-download-web
npm ci
npm run dev
# http://127.0.0.1:5180/
```

別ターミナルで以下を実行します。

```sh
npm run check
npm run browsers:install
npm run test:e2e
npm run build
npm run preview
# http://127.0.0.1:5180/ （devを停止してから）
```

- `check`: strict TypeScript型チェック → Node組み込みテスト → 型チェック付き本番ビルド。
- `test`: URL・状態・HTMLエスケープ・静的リンク・配置パスのネットワーク不要テスト。
- `test:e2e`: `/launcher/`をベースにビルドし、5181番のローカル検証サーバーとChromium / Firefox / WebKitで検証。
  サーバーは終了時に閉じます。すでに5181番が使われていれば失敗し、別アプリを停止しません。
- `browsers:install -- --with-deps`: Linux CIでブラウザーのOS依存も導入する場合。
- `dist/`: 公開するHTML・CSS・JS・ロゴ。テスト素材・ソース・Node実行環境は含みません。
- 納品時の同内容のZIPは`build/pandd-launcher-download-web.zip`。設定を変更した後は再ビルドした`dist/`を使ってください。
- `build/e2e-results.json`、`build/screenshots/`: テストレポートとPC／スマートフォン画像。
- `test-results/`: 失敗時の画像・trace。これらの生成物と`node_modules/`はGit対象外です。

この規模には専用lint設定を追加せず、strict型検査、ビルド、設定テスト、ブラウザーテストで確認します。
外部配布先の確認はローカルテストから分離しています。CIは検証と成果物の保存だけで、公開処理はありません。
既存のrelease・Docs・ゲーム配信ワークフローは変更していません。

## 設定は site.config.ts に集約

| 項目 | 設定 |
| --- | --- |
| タイトル | `title`（画面中央に1回表示） |
| キャッチコピー | `tagline` |
| ロゴ | `logoUrl`（ヘッダー左上）。`null`ならPandDの文字組み |
| 動画 | `background.videoUrl`。提供された3本を連結した`media/showreel-202609-v1.mp4` |
| 静止画 | `background.posterUrl`。動画から抽出した`media/showreel-202609-v1.jpg` |
| 動画・静止画の注視点 | `background.objectPosition`。`"50% 50%"`など0〜100%の2値 |
| 各OS | `downloads.windows` / `macos` / `linux` |

ローカル素材は`public/media/`に置き、例えば`videoUrl: "media/showreel-202609-v1.mp4"`、
`posterUrl: "media/poster-202609-v1.webp"`のように指定して再ビルドします。
外部素材は実在するHTTPS URLも指定できます。相対パス・`/media/...`は配布ページのベース配下を指します。
HTTP、空文字、危険なスキーム、親ディレクトリへの移動、`available`のURL欠落はビルドエラーです。
動画・画像の404やブラウザーの対応コーデックはビルドからは判定できないため、実サーバーで別途確認してください。

現在のロゴはルート`assets/images/PandDLogo.png`の無加工コピーです（ランチャー本体も使用）。
正方形画像の余白をCSSの`object-fit: cover`で表示枠の外に置いています。別の縦横比のロゴに差し替える場合は
`src/style.css`の`.brand-logo`と`.brand-logo img`を確認してください。画像そのものは変更しません。
色、暗幕、文字サイズ、余白、ボタン寸法はCSS冒頭の変数に集約しています。縦並びの境界は48remです。
暗幕は画面全体に黒60%（`--scrim-opacity`）を重ね、中央には追加の黒20%グラデーション（`--center-opacity`）を設定しています。

### OS別ダウンロード

配布中のOSは以下の形式にします。URLは正式公開物の検証後に設定してください。

```ts
{ status: "available", url: "確認済みの正式HTTPS URL", detail: "確認済みの対応CPU等" }
```

未提供のOSは必ず以下にします。URLを推測したり別OSのリンクで代用したりしません。

```ts
{ status: "comingSoon", url: null }
```

`detail`は確認できた場合のみ指定します。署名・公証・対応OSバージョンを推測しません。
新しい正式版が出たらGitHub APIまたはRelease画面でdraft/prereleaseでないこと、OS・CPU・アセット名を確認し、
その実在するアセットURLを設定して再ビルド・再配置します。訪問者のブラウザーからGitHub APIは呼びません。
このページは確認済みのタグ固定URLを採用しており、最新リリースへ自動追従しません。

2026-09-06の確認結果：

- [GameLauncher-Releases v1.0.5](https://github.com/koto-thing/GameLauncher-Releases/releases/tag/v1.0.5)：正式公開、WindowsオンラインインストーラーとWindows x86_64 ZIP、各SHA-256。
- [GameLauncherの公開リリース](https://github.com/koto-thing/GameLauncher/releases)：v1.0.1〜v1.0.5にもWindows用のみ。Uploaderは別用途のため使用しません。
- Windowsの設定URLをHEAD確認：GitHubから`release-assets.githubusercontent.com`へリダイレクト、最終200、
  `application/octet-stream`、`Content-Disposition: attachment`、33,337,653 bytes、`Accept-Ranges: bytes`。
  実行ファイルのダウンロード・実行はしていません。
- Mac / Linuxの正式公開物は確認できず「準備中」。`.github/workflows/release.yml`には生成定義がありますが公開済みの根拠にはしていません。
- `downloads.koto-thing.com`は既存ランチャー／ゲーム配信基盤のホストです。今回のページの配置先として流用・変更していません。

同様のリンク確認は設定からURLを取り出して行えます（Node 24、外部通信が必要）。

```sh
node --input-type=module -e "import config from './site.config.ts'; const r = await fetch(config.downloads.windows.url, {method:'HEAD'}); console.log(r.status, new URL(r.url).hostname, Object.fromEntries(r.headers));"
```

リンククリックのE2Eではこの設定URLへの要求だけをローカル応答へ差し替え、クリック前の外部要求がゼロであることを確認します。
正式配布先の応答確認は上記HEADの結果と区別しています。

## 動画とアクセシビリティ

現在は提供された「紹介PV.mp4 → douga.mp4 → 10PV.mov」を各10秒ずつ、その順にカット連結した30秒の動画を使用します。
ブラウザー側はこの1本をループします。MP4/H.264、1280×720、30fps、yuv420p、CRF24、音声トラックなし、faststart、約4.5MBです。
元の3ファイルは変更していません。静止画は連結動画の2秒位置から抽出したJPEGです。
FFmpegがあるWindows環境では、アプリのディレクトリで次のコマンドにより配信用ファイルのみ再生成できます。

```powershell
./scripts/prepare-background.ps1 -SourceDirectory 'C:\Users\koton\Downloads'
npm run build
```

生成済みMP4/JPEGを`public/media/`に同梱しているため、通常のビルドに原本やFFmpegは不要です。
公開後の差し替えでは新しい版のファイル名にし、設定も更新してください。

`src/video.ts`は実際のmediaイベントと`play()`の結果に同期します。
初期HTMLには動画の`src`・`autoplay`を出さず、動きを減らす設定の確認後にのみ通常の無音自動再生を開始します。
reduce時は動画要求ゼロで静止画を表示します。JavaScript無効時も動画を取得せず、静止画・タイトル・正式リンクは残ります。
静止画はvideoのposter属性に依存しない独立した背景レイヤーで、両素材の読み込み失敗時はチャコール背景になります。
自動再生拒否や読み込み失敗では静止画を表示し、ダウンロードリンクはそのまま使えます。
タブ非表示時は停止し、元から再生中だった場合だけ復帰時に再開します。動きを減らす設定へ変更した場合も停止を維持します。

320px幅、低い横向き画面、文字拡大時は必要な縦スクロールを許可します。ヘッダーとフッターは通常のレイアウト内に置き、OSボタンに重ねません。フォーカスを明示し、操作領域は44px以上です。外部フォント、CDNアイコン、解析、SW/PWAはありません。

検証用`tests/fixtures/video.mp4`は白一色・2秒・320×180・音声なしの自作MP4（約3KB）。
本番動画ではなく`dist/`にも入りません。FFmpegがある場合の再生成コマンド：

```sh
ffmpeg -f lavfi -i "color=c=white:s=320x180:r=24:d=2" -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart tests/fixtures/video.mp4
```

FFmpegは通常のインストール・ビルド・テストに不要です。テスト用静止画もテストサーバーだけが返します。

## 所有者による公開手順

本番デプロイ、DNS変更、新規公開リリース作成は未実施です。配置するドメイン／ディレクトリは未確定です。
既存のDocs・ストア・配信API・認証用のドメインを上書きしない配置先を所有者が選んでください。

1. 用意した完成済み動画1本と静止画を配置し、`site.config.ts`を設定。動画未提供のままでもページ自体は公開可能です。
2. OS別の正式配布物とリンクを再確認。未公開OSは「準備中」のままにします。
3. `npm ci`、`npm run check`、`npm run test:e2e`を実行。
4. 任意のサブディレクトリへ持ち運べる標準ビルドは`npm run build`（`base: "./"`）。
   配置先を固定する場合は`npm run build -- --base=/launcher/`。
   `test:e2e`は`/launcher/`ビルドを作るため、**公開前に必ず希望するbaseで再ビルド**してください。
5. `dist/`の**中身だけ**を、既存レンタルサーバーの選んだ公開ディレクトリへアップロード。
   `index.html`・`assets/`・`media/`の相対配置を維持し、`/launcher`は`/launcher/`へリダイレクトしてください。
   Node.js、Workers、DB、CMS、常駐プロセス、新規有料プランは不要です。
6. HTMLを短時間キャッシュまたは`Cache-Control: no-cache`にし、ハッシュ付きCSS/JSと版付き素材は長期キャッシュ可。
   素材は`showreel-...-v2.mp4`のように新しいファイル名にし、元動画は保存。新しいアセットを先に配置してからHTMLを更新します。
   更新直後は旧ハッシュのアセットも保持し、閲覧中の利用者の404を避けます。
7. 実環境でHTML/CSS/JS/画像/動画のステータス・MIME型を確認。
   MP4は`video/mp4`、小さなRange GETが`206 Partial Content`と正しい`Content-Range`を返すことを確認。
   MP4の`moov`が先頭にあり先頭から再生できること、キャッシュ更新、動画トリミング、実動画の明暗での読みやすさを確認。
   必要なら原本を残したまま別ファイルへ`ffmpeg -i original.mp4 -c copy -movflags +faststart web-v1.mp4`で配置を最適化します。
8. PC・スマートフォン、キーボード、reduce、JavaScript無効、動画404で確認し、正式Windowsリンクをクリック。
   Mac/Linuxを有効化する場合は各正式配布物も別途確認してください。

ローカル3エンジンの検証は実機Safari/iPhoneの試験を意味しません。本番素材・ホスト設定・実機での確認は公開時に必要です。
詳細な実行結果は[検証記録](VERIFICATION.md)を参照してください。


## Cloudflareの最新版固定URL

Workerと本番公開処理は `../launcher-download-worker/README.md` を参照してください。初回公開後に `node scripts/activate-cloudflare.ts` を実行すると、公開EXEの整合性まで確認してWindowsリンクを固定URLへ変更します。未公開の固定URLを有効リンクとして掲載しないため、初回有効化前は既存の正式GitHub配布先です。

## 表示言語

ヘッダー右側の地球アイコンから日本語・簡体中文・한국어・English・Españolを選べます。翻訳は`src/locales.ts`で管理します。初期表示は日本語で、URLの`?lang=en`等を優先し、指定がなければ保存済みの選択を使用します。保存が禁止されていても切り替え可能です。JavaScript無効時は日本語の静的ダウンロードページを表示し、操作できない言語メニューは非表示です。サイトの表示言語のみを切り替え、配布ファイルは変更しません。

## タイトルフォント

タイトルはNovecentoの代替としてMontserrat Mediumを大文字で使用します。Google Fonts公式リポジトリから取得した可変TTFを`public/fonts/Montserrat.ttf`に同梱し、外部フォントサービスへの接続はありません。SIL Open Font License 1.1は`public/fonts/OFL-Montserrat.txt`に同梱しています。`font-display: swap`によりフォント読込前もタイトルとダウンロードを表示します。

## 現在の公開先（ロリポップ）

Cloudflare Pagesの`pandd-game-launcher`プロジェクトはユーザーの指示により削除しました。今後はロリポップの公開フォルダー`pandd-game-launcher`へFTPSで配布します。2026-09-06に再デプロイし、HTTPS 200、動画のRange応答206、ブラウザーでの無音再生・フォント・言語切り替えを確認済みです。

- 公開URL: https://game-launcher.koto-thing.com/
- 接続設定: Git管理対象外の`.env`に`FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, `PUBLIC_FOLDER`。GitHub Secretsにも登録済みです。
- Node.js 24とPython 3を使用。FTPサーバー名に対する証明書検証を有効にしたExplicit FTPSで接続します。

```powershell
# 接続と配置先の一覧のみ確認
npm run deploy:inspect
# 型検証・設定テスト・ビルド後にアップロード
npm run deploy:ftps
```

公開フォルダーは既存ディレクトリである必要があります。`dist/`のファイルだけを送信し、同名ファイルは`build/remote-backup/<UTC日時>/`へ退避してから上書きします。不要ファイルの削除は行いません。HTMLを最後に配置し、転送完了応答と全ファイルサイズを検証します。`OVERWRITE`はこのスクリプトでは使用せず、`--upload`が上書きを伴う公開操作です。

SSL設定後、公開URL・動画・各言語・ダウンロードボタンを確認します。Cloudflare DNSにPages宛てのCNAMEが残っていればロリポップが指定する配信先へ変更してください。FTPサーバー名をWeb用DNSの宛先として推測で使わないでください。

GitHub Secretsの登録だけでは自動公開は実行されません。現在は上記コマンドによる手動公開です。

FTPサーバーのPWDが空文字を返すため、転送ごとにFTPルートからPUBLIC_FOLDERへ移動して配置先を確定します。公開確認ではサイズ照合だけでなくWeb URLの応答も確認してください。
