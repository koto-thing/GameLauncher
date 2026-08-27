# ゲーム作品をランチャーへデプロイする手順

この文書は、UnityでビルドしたゲームをPandD Game Launcherからダウンロード・
起動できる状態にするまでの手順です。最初にステージング環境で確認し、問題が
なければ本番環境へ公開します。

## 用語

- **ビルド**: Unityプロジェクトから実行可能なゲーム一式を作ること
- **Publisher**: ゲームを分割し、ハッシュ計算、マニフェスト署名、カタログ生成を行うツール
- **マニフェスト**: ゲームのバージョン、ファイル、ハッシュ、起動方法を記録したJSON
- **ステージング**: 一般公開前に動作確認する環境
- **本番**: 実際の利用者へ配布する環境
- **R2**: ゲームファイルを保存・公開するCloudflareのストレージ

## 事前準備

次のものが必要です。

1. Unityで正常に起動できるWindowsビルド
2. ゲーム用の `hero.png` と `thumbnail.png`
3. Python仮想環境とdesktop uploader依存関係

プロジェクトをPowerShellで開きます。

```powershell
cd D:\Pandd\GameLauncher
.\.venv\Scripts\Activate.ps1
```

## Desktop uploaderを使う

Qt製desktop uploaderでメタデータとZIP64 artifactを生成します。このアプリは
R2への公開、マニフェスト署名、GitHub Actions実行を行いません。初回セットアップと操作方法は
`apps/intake-uploader/README_JA.md` を参照してください。

```powershell
.\scripts\local\Run-IntakeUploader.ps1
```

以下のPublisher手順は、今後GitHub Actions runnerへ接続する処理の技術資料です。
運用者がローカルPCから直接公開する用途には使用しません。

## 1. Unityでゲームをビルドする

Unity Editorの **File > Build Profiles** からWindows x86_64向けにビルドします。
実行ファイルだけでなく、`*_Data`、`UnityPlayer.dll`、その他DLLを含む出力一式が
必要です。

例:

```text
UnityBuild/
├─ SampleGame.exe
├─ SampleGame_Data/
├─ UnityPlayer.dll
├─ UnityCrashHandler64.exe
└─ その他のDLL
```

ビルドした `SampleGame.exe` を直接起動し、先にゲーム単体で動くことを確認します。

## 2. ローカルの配布準備場所へコピーする

最終的に次の構成にします。

```text
local-test/
├─ game-build/
│  └─ bin/
│     ├─ SampleGame.exe
│     ├─ SampleGame_Data/
│     └─ その他のビルドファイル
└─ metadata/
   ├─ release.json
   ├─ hero.png
   └─ thumbnail.png
```

更新時は `local-test/game-build/bin` の古い中身をすべて除去してから、新しい
Unityビルド一式をコピーします。上書きだけでは、Unityビルドから削除された
古いファイルが残ることがあります。

`local-test/` は `.gitignore` に登録されているため、ゲーム本体や秘密鍵はGitへ
追加されません。

## 3. release.jsonを編集する

`local-test/metadata/release.json` を編集します。

```json
{
  "gameId": "sample-game",
  "version": "1.0.0",
  "minimumLauncherVersion": "1.0.1",
  "publishedAt": "2026-08-12T00:00:00Z",
  "engine": "unity",
  "entrypoint": "bin/SampleGame.exe",
  "workingDirectory": "bin",
  "saveDirectoryName": "SampleGame",
  "display": {
    "ja-JP": {
      "name": "サンプルゲーム",
      "summary": "ゲームの説明"
    },
    "en-US": {
      "name": "Sample Game",
      "summary": "Game description"
    },
    "ko-KR": {
      "name": "샘플 게임",
      "summary": "게임 설명"
    }
  },
  "hero": "hero.png",
  "heroFocalPoint": {
    "x": 0.5,
    "y": 0.5
  },
  "thumbnail": "thumbnail.png"
}
```

重要な項目:

- `gameId` は公開後に変更しない安定した識別子
- `version` は更新のたびに増やす。例: `1.0.0` → `1.0.1`
- `publishedAt` は公開日時をUTC形式で記述
- `entrypoint` は実際のexeへの相対パス
- `workingDirectory` は通常 `bin`
- `minimumLauncherVersion` はこのゲームを扱える最小ランチャーバージョン
- `display` は日本語の `ja-JP` が必須。ほかのBCP 47言語タグは必要なだけ追加可能

同じバージョン番号で異なる内容をR2へ上書きすることはできません。内容を変更したら
必ずバージョンを増やしてください。

## 4. ステージング用配布ツリーを生成する

```powershell
python services\deployment_publisher\publisher.py publish-game `
  --metadata local-test\metadata\release.json `
  --build-dir local-test\game-build `
  --output local-test\r2-public `
  --base-url https://pub-1ada658d7c4f46b1bf109646a4a68bcb.r2.dev `
  --private-key local-test\keys\manifest-private.pem `
  --platform windows `
  --arch x86_64
```

お知らせも生成します。

```powershell
python services\deployment_publisher\publisher.py publish-announcements `
  --source services\distribution-content\content\announcements `
  --output local-test\r2-public
```

エラーなしで終了すれば生成成功です。Publisherは変更のないファイルを同じハッシュの
チャンクとして再利用します。

## 5. ステージングR2へアップロードする

Cloudflare R2で作成した**ステージング専用**の値を現在のPowerShellへ設定します。

```powershell
$env:AWS_ACCESS_KEY_ID = "<ステージングR2 Access Key ID>"
$env:AWS_SECRET_ACCESS_KEY = "<ステージングR2 Secret Access Key>"
$env:R2_ENDPOINT = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
```

Amazon AWSのキーではありません。R2がS3互換APIを使うため環境変数名がAWS形式に
なっています。値をソースコード、Git、チャットへ貼らないでください。

```powershell
python services\deployment_publisher\publisher.py upload `
  --output local-test\r2-public `
  --endpoint $env:R2_ENDPOINT `
  --bucket pandd-launcher-staging
```

## 6. ステージングで確認する

ブラウザでカタログを開きます。

```text
https://pub-1ada658d7c4f46b1bf109646a4a68bcb.r2.dev/v1/catalog/ja-JP/windows/x86_64.json
```

次にステージング版ランチャーを起動し、以下を確認します。

1. カタログにゲームが表示される
2. 画像と説明が表示される
3. ダウンロードが完了する
4. Unityゲームが起動する
5. ランチャー再起動後もインストール済みと認識される
6. 検証と修復が成功する
7. 新しいゲームバージョンへ更新できる

## 7. 本番用配布ツリーを生成する

ステージングで問題がなければ、本番URL、本番秘密鍵、本番R2認証情報へ切り替えます。
ステージング鍵を本番で再利用しないでください。

初回だけ `.env.production.example` を `.env.production` へコピーし、`<...>` の値を
本番用の実際の値へ置き換えます。

```powershell
Copy-Item .env.production.example .env.production
notepad .env.production
```

`.env.production` はGitの対象外です。実際の認証情報を含むため、Gitへ追加したり、
チャットへ貼り付けたりしないでください。新しいPowerShellを開いたときは、次の
1コマンドでそのセッションへ設定を読み込みます。

```powershell
. .\scripts\local\Import-DotEnv.ps1 .env.production
```

先頭のピリオドと、その後の空白が必要です。読み込んだ値は現在のPowerShellだけで
有効になり、ウィンドウを閉じると消えます。Windowsのユーザー環境変数へ秘密情報を
保存する必要はありません。

```powershell
python services\deployment_publisher\publisher.py publish-game `
  --metadata local-test\metadata\release.json `
  --build-dir local-test\game-build `
  --output $env:PANDD_PUBLIC_OUTPUT `
  --base-url $env:PANDD_BASE_URL `
  --private-key $env:PANDD_PRIVATE_KEY `
  --platform windows `
  --arch x86_64

python services\deployment_publisher\publisher.py publish-announcements `
  --source services\distribution-content\content\announcements `
  --output $env:PANDD_PUBLIC_OUTPUT

python services\deployment_publisher\publisher.py upload `
  --output $env:PANDD_PUBLIC_OUTPUT `
  --endpoint $env:R2_ENDPOINT `
  --bucket $env:R2_BUCKET
```

## 8. 本番公開を確認する

```text
https://downloads.koto-thing.com/v1/catalog/ja-JP/windows/x86_64.json
```

本番版ランチャーでインストール・起動まで確認します。公開後に問題が見つかった場合、
同じバージョンを上書きせず、修正した新しいバージョンを発行します。

## ゲーム更新時の短縮チェックリスト

1. Unityで新しいゲームをビルド
2. `local-test/game-build/bin` を完全に入れ替える
3. `release.json` の `version` と `publishedAt` を更新
4. ステージング用 `publish-game` を実行
5. ステージングR2へ `upload`
6. ランチャーで差分更新・起動・修復を確認
7. 本番用 `publish-game` を実行
8. 本番R2へ `upload`
9. 本番カタログと起動を確認

## よくあるエラー

### OpenSSL was not found

```powershell
$env:OPENSSL_EXECUTABLE = "C:\Program Files\OpenSSL-Win64\bin\openssl.exe"
```

### HTTPのlocalhost URLがマニフェストに残る

本番公開時の `--base-url` が `https://downloads.koto-thing.com` であることを確認し、
本番用出力へ再生成してください。

### R2でimmutable objectの上書きを拒否された

公開済みバージョンと異なる内容を同じ番号で作っています。`release.json` の
`version` を増やし、再生成してください。

### カタログが404になる

`publish-game` 後に正しい出力ディレクトリを `upload` したか、バケット名とURLの
環境が一致しているか確認してください。
