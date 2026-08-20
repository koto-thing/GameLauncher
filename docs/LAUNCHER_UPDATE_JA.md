# PandD Game Launcherを更新する手順

この文書は、インストール済みランチャーをQt Maintenance Tool経由で新しい
バージョンへ更新するための手順です。

## 更新の仕組み

ランチャー更新には、次の4つのバージョンを一致させる必要があります。

1. CMakeでビルドされるランチャー本体
2. 日本語のリリース情報
3. 英語のリリース情報
4. GitHub Actionsへ渡すバージョンまたはGitタグ

さらに、日本語・英語の更新履歴にも同じバージョンの項目が必要です。不一致がある
場合、ワークフローは公開前に失敗するようになっています。

以下では `1.0.1` から `1.0.2` へ更新する例を使います。

## 1. CMakeのバージョンを更新する

`CMakeLists.txt` の先頭付近を変更します。

```cmake
project(PandDGameLauncher VERSION 1.0.2 LANGUAGES CXX)
```

## 2. 日英リリース情報を更新する

`backend/content/launcher/release.ja-JP.json`:

```json
{
  "version": "1.0.2",
  "mandatory": false,
  "title": "ランチャー更新内容",
  "publishedAt": "2026-08-12T00:00:00Z"
}
```

`backend/content/launcher/release.en-US.json`:

```json
{
  "version": "1.0.2",
  "mandatory": false,
  "title": "Launcher update",
  "publishedAt": "2026-08-12T00:00:00Z"
}
```

通常更新は `mandatory: false` にします。重大なセキュリティ問題など、更新しないと
利用を継続できない場合だけ `mandatory: true` にします。

## 3. 日英更新履歴を更新する

`backend/content/launcher/changelog.ja-JP.json` の `releases` 配列へ新しい項目を
先頭に追加します。

```json
{
  "version": "1.0.2",
  "title": "ランチャー更新内容",
  "publishedAt": "2026-08-12T00:00:00Z",
  "changes": [
    "変更内容1",
    "修正内容2"
  ]
}
```

`backend/content/launcher/changelog.en-US.json` にも同じバージョンの英語項目を
追加します。

## 4. バージョン整合性を確認する

```powershell
cd D:\Pandd\GameLauncher
.\.venv\Scripts\Activate.ps1
python -m scripts.release.validate_release_version v1.0.2
```

成功時は次だけが表示されます。

```text
1.0.2
```

エラーが出た場合は、そのメッセージに書かれたファイルのバージョンを修正します。

## 5. ローカルテストを実行する

```powershell
python -m unittest discover -s scripts/tests -p "test_*.py" -v
python -m unittest discover -s installer -p "test_*.py" -v
python -m unittest discover -s contracts -p "test_*.py" -v
```

C++側もビルド・テストします。

```powershell
$env:Path = "D:\ProgramFiles\Qt\Tools\mingw1310_64\bin;D:\ProgramFiles\Qt\6.10.2\mingw_64\bin;$env:Path"
cmake --build cmake-build-debug --parallel
ctest --test-dir cmake-build-debug --output-on-failure
```

## 6. ステージングへ公開する

変更をコミットしてGitHubへpushします。

```powershell
git add CMakeLists.txt backend/content/launcher scripts docs
git commit -m "Prepare launcher 1.0.2"
git push
```

GitHubの **Actions > Publish Windows staging > Run workflow** を開き、次を入力します。

```text
version: 1.0.2
```

ワークフローは次を自動実行します。

1. バージョン整合性検証
2. Releaseビルド
3. 配置済みランチャーのスモークテスト
4. Qt IFW更新リポジトリ生成
5. 未署名オンラインインストーラーとZIP生成
6. SHA-256生成・検証
7. ステージングR2へのアップロード

## 7. 既存ランチャーから自己更新を確認する

新しいインストーラーで上書きせず、ひとつ前のバージョンをインストールした状態から
確認します。

1. 旧バージョンのランチャーを起動
2. 設定画面の **更新と通知** を開く
3. **更新を確認** を押す
4. `1.0.2` が表示されることを確認
5. **アップデート** を押す
6. ランチャーが終了し、Maintenance Toolが起動することを確認
7. 更新完了後にランチャーを起動

更新後に確認します。

- 表示バージョンが `1.0.2`
- 設定が保持されている
- インストール済みゲーム情報が保持されている
- カタログを取得できる
- ゲームを起動できる
- `maintenancetool.exe` が残っている

## 8. 本番公開の準備をする

ステージング更新に成功したら、次を確認します。

- `downloads.koto-thing.com` が本番R2バケットへ接続済み
- GitHub `production` 環境のSecretsが設定済み
- 本番公開鍵がランチャーへ設定される
- 本番ゲームカタログが先に公開済み
- `docs/WINDOWS_RELEASE_ACCEPTANCE.md` の確認準備ができている

## 9. 本番タグを発行する

本番公開はタグpushで開始します。タグは一度公開したら同じ名前を使い回しません。

```powershell
python -m scripts.release.validate_release_version v1.0.2
git tag v1.0.2
git push origin v1.0.2
```

GitHub Actionsの **Publish Windows production** が自動で開始されます。

成功すると次が公開されます。

- `downloads.koto-thing.com` 上のIFW更新リポジトリ
- 未署名オンラインインストーラー
- ランチャーZIP
- 両方のSHA-256 sidecar
- 日英ランチャー更新情報と更新履歴
- GitHub Releaseの同じ4ファイル

## 10. クリーンWindowsで最終確認する

`docs/WINDOWS_RELEASE_ACCEPTANCE.md` に従って、Windows SandboxまたはクリーンVMで
確認します。特に次を確認します。

1. 初回インストール
2. SmartScreenの「不明な発行元」警告
3. SHA-256一致
4. ゲーム取得・起動・更新・修復
5. 旧ランチャーから新ランチャーへの自己更新
6. アンインストール後もゲームとセーブデータが残ること

## 更新に失敗した場合

### 新しいバージョンが表示されない

- 日英 `release.*.json` のバージョンを確認
- GitHub Actionsが成功しているか確認
- `/v1/launcher/releases/ja-JP/windows/x86_64/latest.json` をブラウザで確認
- 古いランチャーがステージング・本番の正しい環境を向いているか確認

### Maintenance Toolが見つからない

IDEから直接起動したランチャーではなく、Qt IFWインストーラーからインストールした
ランチャーで試してください。Maintenance Toolはインストール先のルートにあります。

### immutable objectの上書きを拒否された

公開済みタグやバージョンを別内容で再利用しています。バージョンを増やし、新しい
タグで公開してください。

### 更新後も表示バージョンが古い

`CMakeLists.txt` の `project(... VERSION ...)` を更新せず、IFWだけ新しい番号で
生成した可能性があります。全バージョンを一致させ、さらに新しい番号で再公開します。
