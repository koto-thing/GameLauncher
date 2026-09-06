# 検証記録 — 2026-09-06

最新の変更：背景に静的な横線ノイズとコントローラー・十字キーの意匠を追加。円弧と縦線は削除し、ロゴに合わせたピンク・チャコール・白へ配色を統一。今回の確認はChromiumの21ケースと設定テスト5件です。

## 対象と変更範囲

`apps/launcher-download-web/`を新設。ルートREADMEに案内を1行追加し、
`.github/workflows/launcher-download-check.yml`にPR／手動実行の検証だけを追加しました。
既存ランチャー、リリース生成・署名、認証、Control Plane、Docs公開、配信基盤は変更していません。
作業開始時から存在する音楽アプリ・Docsの未コミット変更、および作業中に増えた他アプリの変更も対象外です。
コミット・push・本番デプロイ・DNS変更・公開リリース作成は行っていません。

## 確認済み配布先

公開APIを2026-09-06（JST）に読み取り確認しました。

| 対象 | 結果 |
| --- | --- |
| [GameLauncher-Releases latest API](https://api.github.com/repos/koto-thing/GameLauncher-Releases/releases/latest) | `v1.0.5`、draft=false、prerelease=false、2026-08-24T09:04:01Z公開 |
| Windows | オンラインインストーラー33,337,653 bytes、Windows x86_64 ZIP53,730,093 bytes、各SHA-256ファイル |
| [GameLauncher releases API](https://api.github.com/repos/koto-thing/GameLauncher/releases?per_page=10) | v1.0.1〜v1.0.5はWindows用4アセット。別用途のUploader releaseは不採用 |
| Mac / Linux | 上記公開物には見当たらず。CIにあるビルド定義から公開済みとは判断せず、準備中 |

Windowsのボタンは`site.config.ts`のタグ固定URLへ直接リンクします。
そのURLをHEAD要求で確認し、GitHubから`release-assets.githubusercontent.com`へのリダイレクト後に
HTTP 200、`application/octet-stream`、`Content-Disposition: attachment; filename=PandD-Game-Launcher-Online-Installer.exe`、
Content-Length 33,337,653、Accept-Ranges bytesを確認しました。実行ファイルは取得・起動していません。
他の未文書化の配布場所の有無は未確定です。

## 実施した検証と読み方

- Node.js 24.18.0、TypeScript 6.0.2 strict、Vite 8.2.2、Playwright 1.63.0。
- `npm run check`相当の型チェック・5件の設定／HTMLテスト・本番ビルドを実行。
- Chromium / Firefox / WebKitの実ブラウザーエンジンで同じ21ケース、計63ケースを実行（提供動画の確認を追加）。
- 前回の3エンジン確認結果：**63 passed、失敗0、skip0、flaky0**。型チェック・5件の設定テスト・最終ビルドも成功。
- コマンド、結果の詳細、時間は`build/e2e-results.json`。画像は`build/screenshots/`。
- 最終成果物は相対baseの`dist/`。`/launcher/`指定ビルドもE2Eで検証。
- 同じ成果物を`build/pandd-launcher-download-web.zip`に保存。提供動画から生成したMP4とJPEGを含む静的ファイル6個で、テスト素材は含みません。
- 新規CIワークフローはYAML解析、read-only権限、PRのパス制限を確認。GitHub上でのCI実行は未実施。
- アプリ内ブラウザーでも開発サーバーの実表示を確認し、コンソールのwarning/errorはゼロ。

| ケース | 確認内容 |
| --- | --- |
| PC | 1920×1080 / 1366×768、中央揃え、3OS同寸の横並び、スクロールなし |
| スマートフォン | 390×844 / 320×568 / 667×375、同寸の縦並び、横スクロールなし |
| 文字拡大 | CSS文字サイズ200%、683×384と390×844。縦スクロールで全操作へ到達、動画ボタンが重ならない |
| 提供状態 | 初期HTMLに正式Windowsリンクと無効なMac/Linux、クリック前の外部要求ゼロ |
| 全OS提供時 | テスト設定で3OSを有効化し、長い補足の折り返しでも同じボタン寸法を維持 |
| 動画 | 自作MP4を実際にデコードし、muted / loop / playsinline、再生時刻の進行とループを確認 |
| ヘッダー・フッター | ヘッダーにPandDロゴ、フッターに© PandDを表示。中央にロゴの重複なし。再生操作ボタンなし、文字拡大時も重ならない |
| reduce | 初期srcなし、HTTPサーバー実測で動画要求ゼロ。静止画を表示。実行中の設定変更で停止 |
| 再生拒否 | `play()`のNotAllowedErrorを注入し、静止画を維持し、未処理例外なし |
| 障害 | HTTP 404、サーバー接続切断、MP4でないデータ、動画と静止画の両方404。リンク維持・再生ボタン非表示 |
| 読み込み中 | テストサーバーで動画応答を保留してもダウンロード表示。保留中にreduceへ変更しても遅延再生しない |
| タブの可視性 | 実video要素に対してdocument.hiddenとvisibilitychangeをテスト注入。再生中のみ復帰、reduceによる停止を維持 |
| JS無効 | ブラウザーのJavaScriptを無効化。静止画・タイトル・正式hrefが残り、動画要求なし |
| キーボード | Chromium / FirefoxのTab順序、全エンジンのフォーカス表示とEnterによるリンク要求 |

### 検証の限界

- タブの可視性はheadless環境で再現性を保つためイベント注入で検証。物理的なタブ切り替えの実機試験とは区別します。
- 文字拡大はCSSルート文字サイズ200%と狭いビューポートで検証。各実機ブラウザーのズームUIを操作した試験ではありません。
- Windows版Playwright WebKitは初期Tabでリンクへフォーカスせず、ルート差し替え応答のdownloadイベントも返さなかったため、
  明示フォーカス後のEnterと正式URLへの要求で確認しています。Chromium / FirefoxではTabとdownloadイベントまで確認。
- E2Eは外部インストーラーを取得せず、設定URLへの要求だけをテスト応答へ差し替え。
  実配布先のHTTP応答は、別に行った公開HEAD確認が根拠です。
- FirefoxはWindowsの制限環境では起動タイムアウトしたため、許可後に通常権限で再実行。
  ブラウザー実体は既存の`apps/music/build/browsers`にある同版を読み取り利用しました。アプリ側にはそのパスへの依存を入れていません。
- `npm`の既定ラッパーがこの端末で正しく解決されなかったため、実行時は
  `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"`を使用。npmスクリプト内の`npm run`は正常に完走しました。
- macOS / iPhone / Android実機、本番ホストのMIME・Range・キャッシュは未検証です。提供されたゲーム映像はローカルで確認済みです。

## スクリーンショット

現在の背景動画を含む画面：

- [PC 1920×1080](build/screenshots/chromium-1920x1080.png)
- [PC 1366×768](build/screenshots/chromium-1366x768.png)
- [スマートフォン 390×844](build/screenshots/chromium-390x844.png)
- [狭幅 320×568](build/screenshots/chromium-320x568.png)
- [横向き 667×375](build/screenshots/chromium-667x375.png)

白一色の自作テスト動画による明るい場面の読みやすさ・フォーカス確認（本番素材ではありません）：

- [PC・明るい動画・フォーカス](build/screenshots/chromium-bright-video-focus.png)
- [スマートフォン・明るい動画](build/screenshots/chromium-bright-video-mobile.png)
- [200%文字](build/screenshots/chromium-text-200.png)
- [スマートフォン・200%文字](build/screenshots/chromium-mobile-text-200.png)

同名の`firefox-` / `webkit-`画像も保存します。生成物はGitから除外され、ローカル実行またはCIアーティファクトで取得します。

## 未提供・所有者の作業

動画追加の確認：`紹介PV.mp4`（0〜10秒）→`douga.mp4`（10〜20秒）→`10PV.mov`（20〜30秒）。
1280×720 / 30fps / H.264のMP4、30秒、4,481,032 bytes、音声ストリームなしをffprobeで確認。
各シーンの2秒・12秒・22秒位置を実際にデコードして撮影し、30秒から先頭へのループを3エンジンで確認しました。
アプリ内プレビューでもmuted=true、loop=true、paused=falseを確認。
Windows WebKitはvideoWidth/videoHeightに表示寸法を返したため、エンコード解像度の根拠にはffprobeを使用しています。

- [提供動画・PC](build/screenshots/chromium-supplied-12s.png)
- [提供動画・スマートフォン](build/screenshots/chromium-supplied-mobile.png)

追記：提供された3本の動画を30秒の無音背景MP4に連結し、静止画も抽出・設定済みです。素材の未提供事項は解消しました。
Mac/Linuxの正式公開URL、配布ページの本番ドメイン／配置ディレクトリは未確定です。
所有者は[READMEの公開手順](README.md#所有者による公開手順)に従って素材・URLを設定し、
希望するbaseで再ビルドして`dist/`を静的ホストへ配置し、実環境・実機で確認してください。
このページの完成は3OSの配布物が揃ったことを意味しません。
