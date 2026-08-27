# Live2D背景の開発・登録

ゲーム詳細画面は、hero画像・Live2Dモデル・可読性グラデーションをOpenGLで合成し、
操作用Qt Widgetsを前面に配置する。ゲームごとに1モデルを登録できる。
登録がないゲームはhero画像だけを表示する。

## Windowsの開発環境

MSVC v143 / x64、MSVC 2022版Qt 6.10.2、CMake、Ninja、vcpkg、Cubism Native SDK 5-r.5を使用する。
MinGW版QtとMSVC版Qtを同じビルドディレクトリに混在させない。
Visual Studio 2026にv143（14.44）を追加した環境でも、選択するコンパイラはMSVC 2022系列となる。

```powershell
./scripts/local/Build-LauncherWindows.ps1 `
  -QtRoot '<Qt>/6.10.2/msvc2022_64' `
  -CubismSdkRoot 'D:/ProgramFiles/CubismSdkForNative-5-r.5' `
  -VcpkgRoot '<vcpkg>'
```

出力先は `build/msvc-debug`。`-Configuration Release` の場合は `build/msvc-release`。
このスクリプトはstagingビルドを作成し、既存テストとLive2D登録テストを実行する。
日本語MSVCのヘッダー依存関係をNinjaが正しく読めるよう、コンソールのコードページもUTF-8に設定する。
公開用ビルドは既存のrelease Workflowを使う。

SDKは実行時には不要。Coreをリンクし、Frameworkのシェーダーと登録済み素材をQtリソースへ組み込む。
起動時の作業ディレクトリやゲーム本体のインストール先には依存しない。

## 公式SDKの取得とCI

取得元はLive2D公式の固定版アーカイブ:
[Cubism SDK for Native 5-r.5](https://cubism.live2d.com/sdk-native/bin/CubismSdkForNative-5-r.5.zip)。

SDKの利用条件を確認・同意した所有者が、GitHubのActions変数
`PANDD_CUBISM_LICENSE_ACCEPTED=accept` を設定する。
CIからの利用が契約上許可されるか不明な場合は、設定する前にLive2Dへ確認する。
Workflowの追加だけでは、この同意や公開の許諾を代行しない。

```powershell
$env:PANDD_CUBISM_LICENSE_ACCEPTED = 'accept'
python -m scripts.dependencies.download_cubism_sdk `
  --destination build/dependencies/official/CubismSdkForNative-5-r.5
```

取得スクリプトにはPython 3.13以降を使用する。
取得処理は版・SHA-256・サイズと展開パスを検証する。
CIではSDKをrunnerの一時領域へ展開し、SDK自体は公開artifactへ含めない。
SDK版の変更は、公式の更新内容、ダウンロードハッシュ、Core/Frameworkの互換性を確認する変更として扱う。

## モデルの登録

使用許諾を確認したモデル一式を `apps/launcher/resources/live2d/<モデル名>/` へ配置し、
`apps/launcher/resources/live2d/models.json` の `games` に対象gameIdを登録する。
`.model3.json` から参照されるテクスチャやモーションの相対配置を維持する。

```json
{
  "games": {
    "your-game-id": {
      "model": "character/character.model3.json",
      "idleGroup": "Idle",
      "centerX": 0.65,
      "centerY": 0.5,
      "scale": 1.0
    }
  }
}
```

- `model`: このディレクトリを基準にした相対パス。絶対パスや上位ディレクトリへの参照は禁止。
- `idleGroup`: モデルに定義された待機モーショングループ。待機モーションを使わない場合は空文字。
- `centerX` / `centerY`: 詳細画面内での中心位置。左上が0、右下が1。
- `scale`: モデルのキャンバス高を画面高に合わせた倍率。0.1〜4。

5項目すべてを指定する。素材追加後にCMake configureとビルドを実行し、同梱内容を更新する。
モデル更新にはランチャー更新が必要。モデル専用ネット配信や利用者による任意モデル取込は実装しない。
通常配布用の登録は空にしてある。SDKサンプルを本番ゲームに自動で割り当てることはしない。

## 実描画の検証

`BUILD_TESTING=ON` のときだけ生成される `Live2DPreview` は、外部の許諾済みモデルを使って
本番と同じ背景・前面UIコンポーネントを検証する。ゲームカタログや保存状態は変更しない。

```powershell
./build/msvc-debug/Live2DPreview.exe `
  --model 'D:/ProgramFiles/CubismSdkForNative-5-r.5/Samples/Resources/Haru/Haru.model3.json' `
  --screenshot build/live2d-preview.png --verify
```

`--verify` はモデルの画素変化、前面ボタン、停止・再開、最小化、非表示・復帰、サイズ変更、
同じモデルの再選択、解放・再読み込み、読み込み中の選択変更を確認し、
成功時に0、失敗時に非0で終了する。`--verify` を省けば画面を操作して確認できる。
目視ではマスク、半透明、輪郭、前面ボタン、縦横比、高DPIを確認する。
既存の `--smoke-test` はGUI描画をしないため、Live2Dの描画確認にはならない。

## 実行時の動作

画面表示中は約30fpsを上限にSDKを更新する。詳細画面を離れたとき、最小化・トレイ格納時、
ゲーム実行中は更新を止める。復帰時に経過時間をリセットする。
ファイル読み込み・画像デコードはQtConcurrentで行い、選択変更後に届いた古い結果は破棄する。
GPU生成・描画・解放はGUIスレッドのOpenGLコンテキスト上で行う。
別モデルの選択時は前モデルのGPU資源を解放し、同じモデルの再選択では再読込しない。
モデル読込失敗はステータス表示とログに通知し、インストール状態には反映しない。

## 公開前の確認

Core/Frameworkとモデル素材の利用許諾を確認する。
特に複数ゲームへアクセスするランチャーが拡張性アプリケーションに該当するかは、Live2Dへ確認する。
公式URLから取得できることは、公開許諾が不要であることを意味しない。
参考: [Core使用許諾契約](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_jp.html)。

## 検証結果（2026-08-27）

- Windows / MSVC 19.44.35228 / Qt 6.10.2 / Cubism 5-r.5 / GLEW 2.3.1でDebug・Releaseビルド成功。
- Debug・ReleaseともCTestの5グループ成功（既存のダウンロード・プロセス起動テストを含む）。
- Pythonのscripts/testsは35件成功。WorkflowのYAMLとPowerShellブロックは構文検証済み。
- SDKのHaruを開発用プレビューで描画し、100%・150%・200%の倍率で確認。
- 配布フォルダーへinstallし、Qt/GLEW/OpenSSLを開発用PATHから除いた起動テストに成功。
- 日本語MSVCでNinjaのヘッダー依存関係が記録されることを確認。
- 配布DLLのハッシュがRelease版と一致。SDKアーカイブ・Coreライブラリ・ソース・サンプル素材は配布フォルダーに含めていない。
- SBOMと公式ライセンス文書の取得・ハッシュ検証に成功。

GitHub上のWorkflow実行、macOS/Linuxの実ビルド・描画、本番モデルの登録・公開は未実施。
ライセンス同意用のGitHub変数は所有者による設定が必要。
