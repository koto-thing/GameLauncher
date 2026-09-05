# PandD Music

一般リスナーがログインなしでゲームOSTを聴き、作品担当者が音源・画像・クレジット・区間ループを登録して、自分の判断で公開できるWebアプリです。`apps/music` 内で独立しており、既存GameLauncherやDocsの認証・DB・配信には接続しません。

**ローカル実装です。本番公開・実GitHub OAuth・実Cloudflareリソースへの接続は未実施です。** 実作品の素材は含めていません。デモは2作品6曲の自作検証トーンです。

## 構成

React 19 + Vite 8、TypeScript 6 strict、React Router、Hono、Cloudflare Workers Static Assets、D1、非公開R2、GitHub OAuth（state + PKCE S256）。Domain・Application・Infrastructure・Presentation・Compositionを分離します。詳細は [architecture.md](docs/architecture.md)。

既存モノレポのTypeScript 7は、現在のtypescript-eslintの対応範囲外だったため、本アプリは互換性が成立する6.0.2を固定しています。他アプリの依存は変更していません。workerdに合わせ互換日を2026-09-02としています。依存は `package-lock.json` で固定しています。

## ローカル起動

Node.js 24以上（24.18.0で確認）、npm、Windows/macOS/Linuxを想定。初回はネットワークから依存を取得します。

```sh
cd apps/music
npm ci
npm run types
npm run seed
npm run dev
```

[http://127.0.0.1:5173](http://127.0.0.1:5173) を開きます。作品URLは `/games/:id`、曲の共有URLは `/tracks/:id`、管理は `/manage`。URLを開いただけでは自動再生しません。終了はCtrl+C。

`npm run dev` は明示的なローカルデモサーバーです。APIは127.0.0.1:8789、画面は127.0.0.1:5173だけで待ち受けます。D1/R2は `.wrangler/local/` 以下に永続化します。外部認証なしで試せる固定アカウントは以下です。

| アカウント          | 権限                                           |
| ------------------- | ---------------------------------------------- |
| admin / 900001      | 運営。作品作成、割当、全作品、広告、停止、履歴 |
| composer-a / 900002 | DEMO 1の担当者                                 |
| composer-b / 900003 | DEMO 2の担当者                                 |
| outsider / 900004   | ログイン可能だが担当なし                       |

デモ認証のHTTP入口は `tests/support/local-worker.ts` に限定し、本番エントリーからimportしません。loopback・Origin・環境・固定fixture IDを検証します。本番bundle検査と実Workerテストで混入を検出します。GitHubログイン時の権限チェックを省略する設定はありません。

seedはサーバー停止中に実行してください。完成済みデモ曲は再登録しません。DEMO以外の作品が存在する場合は投入を停止します。これは本番用データ投入機能ではありません。

## 投稿・公開

1. 運営で作品を作成し、ログイン済みの担当者を**GitHub数値IDでも確認して**割り当てます。
2. 担当者は作品紹介・作品画像を保存し、権利確認後に作品を公開できます。
3. 曲を追加、または複数の音源を一括で下書き登録します。一括登録は1件ずつ処理し、各ファイルの成否を表示します。
4. 音源、代表画像、代替テキスト、複数の公開名・役割、曲順、制作コメントを編集します。
5. 音源の差し替え後は一度保存し、旧ループを引き継がず改めて設定します。開始・終了の秒数、現在位置の採用、継ぎ目試聴を使えます。
6. 音源・画像・クレジットと広告付きサイトでの利用の確認後、「この曲を公開する」または「更新を反映する」を押します。運営の事前承認はありません。

保存だけでは公開中のタイトル・音源・画像・ループ・曲順を変更しません。一般配信には作品と曲の両方の公開が必要です。作品停止中は曲や作品画像の新規アクセスも止まります。公開済み素材を利用者が保存したコピーは回収できません。

## 対応素材と音声

- 音源：MP3 / PCM WAV、モノラル・ステレオ、64MiBまで、最大600秒。
- 画像：JPEG / PNG / WebP、8MiBまで、最大辺4096px。SVG・HTML・動画は拒否します。
- 拡張子・申告MIMEだけでなく実データ、容量、画像寸法、音源メタデータをR2から検証します。音源全体をWorkerでarrayBuffer化しません。画像は8MiB以内で構造も確認します。
- 通常再生はHTMLAudioElement。精密な区間ループはWeb Audioの `AudioBufferSourceNode.loop/loopStart/loopEnd`。必要な1曲だけを48kHzでデコードし、1ジョブずつ実行します。
- PCM予算は96MiB。3分ステレオは約65.9MiBで、圧縮データや作業バッファは別です。予算超過の区間ループ付き公開をAPIでも拒否します。短い音源への差し替え、またはループOFFの通常再生を選べます。
- 元波形とループ境界が不連続ならクリック音が発生します。自動クロスフェードや音源の切り詰めはしません。
- 検証済み形式・ブラウザー・未検証事項は [test-report.md](docs/test-report.md) を参照してください。WebKit自動テストをiPhone実機検証とは扱いません。

## 検証コマンド

```sh
npm run typecheck
npm run lint
npm test
npm run browsers:install
npm run test:e2e
npm run build
npm audit
```

E2Eは5174 / 8790の別サーバーで実D1/R2エミュレーターを起動し、終了時に閉じます。通常のローカル編集データには触れません。ブラウザーは `build/browsers`、画像とJSON結果は `build/`、失敗traceは `test-results/` に出力します。Windowsの制限アカウントではFirefox/WebKitの起動や子プロセスの終了が拒否されることがあるため、ブラウザー起動権限のある端末で実行してください。

`npm run lint` はeslintに加えて層の依存方向・自作関数の `@brief` を検査します。`npm run build` はクライアントの認証秘密混入と、本番Workerへのデモ認証混入を検査します。

MP3/JPEG/WebPの小さな検証fixtureは生成済みでGit管理します。再生成はFFmpegをインストールした端末で `node scripts/generate-media-fixtures.mjs`。通常のテスト実行にFFmpegは不要です。

## 実GitHub OAuthのローカル確認

本番と異なる専用OAuth AppをGitHubで登録します。Homepageは `http://127.0.0.1:5173`、固定Callbackは `http://127.0.0.1:5173/api/auth/callback`。

`.dev.vars.example` を `.dev.vars` にコピーしてClient ID、Client Secret、初期運営のGitHub**数値ID**を設定します。公開bundleへ秘密を入れる `VITE_` 変数は使用しません。

```sh
npm run db:local
npm run dev:oauth
```

これは本番エントリーを使うCloudflare Vite pluginの開発サーバーです。デモ認証はありません。Vite plugin / WranglerのローカルDBはデモサーバーの `.wrangler/local` と別管理です。OAuthで最初にログインした人を無条件に運営にする処理はありません。許可リストはアカウントの初回作成時だけ適用し、DBで剥奪済みの運営ロールを再ログインで復活させません。付与後はbootstrap設定を空にできます。

## 検証環境・本番の準備（未実行）

課金契約、リソース作成、本番公開、DNS変更は所有者の判断で行ってください。以下は実行準備の手順で、実施済みの報告ではありません。

1. Music専用D1と**非公開**R2をstagingとproductionで別々に作成。既存GameLauncherのID・バケットを流用しません。
2. `wrangler.jsonc` の環境ごとの `database_id`、`bucket_name`、`SITE_ORIGIN`、`CONTACT_URL` を設定。`.invalid` の公開先はAPI起動時に拒否します。
3. staging/productionで別のGitHub OAuth Appを登録し、Callbackをそれぞれの正規HTTPS Origin + `/api/auth/callback` に固定。
4. Secretを環境ごとに登録し、型生成・マイグレーション・検証ビルドを行います。

```sh
# 以下は所有者が実リソース名・環境を確認して実行する外部設定コマンド
npx wrangler d1 create pandd-music-staging
npx wrangler r2 bucket create pandd-music-staging
npx wrangler secret put GITHUB_CLIENT_ID --env staging
npx wrangler secret put GITHUB_CLIENT_SECRET --env staging
npx wrangler secret put BOOTSTRAP_ADMIN_IDS --env staging
npx wrangler types
npx wrangler d1 migrations apply MUSIC_DB --env staging --remote
```

PowerShellのstagingビルドは `$env:CLOUDFLARE_ENV='staging'; npm run build`、POSIXは `CLOUDFLARE_ENV=staging npm run build`。本番は `production` に変更。生成された `dist/<Worker出力名>/wrangler.json`（通常のローカルビルドは `dist/pandd_music/wrangler.json`）のname・Bindings・Originが正しい環境か必ず確認します。所有者承認後に `npx wrangler deploy` でVite pluginの生成済み設定から配信します。環境間でdistを使い回さず、必ず対象環境で再ビルドします。ローカル作業へ戻る際はPowerShellで `Remove-Item Env:CLOUDFLARE_ENV` を実行します。

本番前には [operations.md](docs/operations.md) と [test-report.md](docs/test-report.md) の実機・運用チェックを完了してください。CIは検証だけで、自動デプロイしません。

## 費用の前提

2026-09-05に[Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)、[D1料金](https://developers.cloudflare.com/d1/platform/pricing/)、[R2料金](https://developers.cloudflare.com/r2/pricing/)を確認しました。契約時は再確認してください。

Workers Freeは動的100,000 requests/day・CPU 10ms/request、D1 Freeは5,000,000 rows read/day・100,000 rows written/day・総5GB。R2 Standardの無料利用枠は10GB-month、Class A 1M、Class B 10M/月で、超過分は保存$0.015/GB-month、Class A $4.50/M、Class B $0.36/M、R2からの直接egressは無料と記載されています。無料枠の適用・アカウント合算・プラン条件を所有者が確認してください。

初期10曲×10MiB + 画像20枚×1MiBなら約120MiBの保存が出発点です。ただしRange・シーク・ループ開始は複数リクエストを発生させ、公開状態確認にもD1読取が必要です。アクセス数・最大素材の解析CPU・保存世代・バックアップ量を実測して費用判断してください。64MiBのMP3解析がFree CPU枠で完了するとは未検証で、無料運用を保証しません。課金への変更を自動で行いません。

## 文書

- [設計と依存方向](docs/architecture.md)
- [パラメータ変更](docs/parameter-guide.md)
- [コメント方針](docs/comment-guidelines.md)
- [運用・バックアップ・復元](docs/operations.md)
- [テスト結果と未検証事項](docs/test-report.md)
- [今回の対象外](docs/future-scope.md)
