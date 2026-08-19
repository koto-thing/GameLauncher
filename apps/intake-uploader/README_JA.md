# PandD Intake Artifact Uploader

> **注記**: 現在はWeb版 Intake（`/intake`）が推奨ワークフローです。ブラウザ上でビルドフォルダを選択して直接Artifact作成・アップロード・Sealを行えます。本デスクトップアプリは互換性維持およびフォールバック用途として提供されています。将来的にWeb版への移行完了後に廃止・削除される予定です。

ゲームビルドをデプロイ申請用のZIP64 artifactへまとめ、非公開intake R2へ送るQt製ツールです。
署名、staging/production R2への書き込み、GitHub Actions実行は行いません。

## 利用者向け

Webアプリの「Windows版uploaderをダウンロード」から
`PandDIntakeUploader.exe` を保存し、ダブルクリックして起動します。
インストールとPowerShell操作は不要です。

作成したartifactとdescriptorは、既定で
`ドキュメント\PandD\Intake Artifacts` に保存されます。

## 開発者向けセットアップ

プロジェクトのPowerShellで次を実行します。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e apps\intake-uploader
```

### ソースから起動

```powershell
.\scripts\local\Run-IntakeUploader.ps1
```

### Windows exeを作成

```powershell
.\apps\intake-uploader\scripts\Build-Windows.ps1
```

成果物は `apps/intake-uploader/artifacts/PandDIntakeUploader.exe` です。
Qt公式の `pyside6-deploy` を使用します。exe作成用のPython 3.12環境とNuitkaは
通常の開発環境から分離し、初回ビルド時に自動で準備します。

既定の出力先は `ドキュメント\PandD\Intake Artifacts` です。変更する場合は
`PANDD_INTAKE_OUTPUT` 環境変数へローカル出力フォルダを指定します。
control plane URLは公開済みWebアプリが既定です。ローカル開発時だけ
`PANDD_CONTROL_PLANE_URL=http://localhost:3000` を指定します。

## 操作

1. ゲームビルド全体を含むフォルダと、その中の起動exeを選ぶ
2. ゲーム情報、日本語、追加言語、画像を入力する
3. 内容を確認してartifactを作成する
4. 表示されたGitHub Device Flowコードで本人確認する（ローカル開発時は省略）
5. 64 MiB partの非公開intake uploadとsealが完了するまで待つ
6. `.pandd-artifact.json` をデプロイWebアプリの「新しい申請」で選ぶ

生成されるdescriptorにはartifact ID、ファイル名、ゲームID、バージョン、容量、
ファイル数、SHA-256だけを含みます。秘密情報やローカル絶対パスは含みません。

## 安全制約

- 元データと生成ZIPは5 GiB以下
- metadataを含むファイル数は50,000件以下
- artifact内パスは240文字以下
- 空ファイル、symlink、reparse point、絶対パス、`..`、Windows予約名を拒否
- 大文字小文字だけが異なるパスの衝突を拒否
- キャンセル時は未完成のローカルartifactを削除
- part URLは15分だけ有効で、一度に最大4件だけ発行
- GitHub token、part URL、ローカル絶対パスを保存・ログ出力しない

日本語（`ja-JP`）は必須です。英語（`en-US`）、韓国語（`ko-KR`）、簡体字中国語
（`zh-Hans`）など、BCP 47形式の言語タグを追加できます。
