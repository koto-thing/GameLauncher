# Launcher開発

## 構成

Launcherは `apps/launcher/src` 内をDomain、Application、Infrastructure、Presentation、Bootstrapへ分けています。Applicationは `Ports.h` の抽象へ依存し、BootstrapのComposition Rootだけが具象依存を接続します。

配信コンテンツは読み取り専用です。Launcherは署名済みManifestと、ビルド時に固定された配布ホスト・公開鍵を検証し、Intakeや署名秘密鍵へアクセスしません。

## ビルドと実行

共有presetの要件と一般的なコマンドは [Development](../DEVELOPMENT.md) にあります。このPCのCLionではGit管理外の `clion-windows` presetを使用します。

```powershell
cmake --preset clion-windows
cmake --build --preset clion-windows --parallel
ctest --preset clion-windows
```

生成された `GameLauncher` targetをCLionまたはVisual Studioから実行します。ローカル配布サーバーを使う場合も、URL末尾の `/` と対応するStaging公開鍵を明示します。

## テスト

CTestはDomain、統合状態、ダウンロード、プロセス、Live2Dを分離しています。GUIを必要としないCIでは `QT_QPA_PLATFORM=offscreen` を使用します。

`PlayStatisticsTests` はSQLite履歴、同意前データの除外、途中保存、終了・中断、送信と削除を検証します。
Qt SQLとSQLiteドライバーが必要です。Windowsの配布では `windeployqt` によりSQLランタイムと
`sqldrivers/qsqlite.dll`（Debugは `qsqlited.dll`）が含まれることを確認してください。

公開C++ APIはDoxygen target `docs-check` でも検証され、未文書化警告をエラーとして扱います。

## プレイ統計

ゲーム詳細に、この端末の直近90日の成功起動回数・観測実行時間・計測中断回数を表示します。
記録はApplication Dataの `play-statistics/<配信環境>/play-statistics.sqlite` へ保存し、
ゲーム本体やsave dataとは分離します。StagingとProductionで履歴・送信同意・認証情報を分けます。
設定の「プレイ統計」で任意送信を有効化・停止し、ローカル履歴またはサーバーの詳細記録を削除できます。
送信設定は統計専用SQLiteで管理し、LauncherSettingsには重複して保存しません。

統計APIをデプロイ後、CMakeの `PANDD_PLATFORM_API_BASE_URL` にHTTPSのoriginを設定してビルドします。
GitHub Actionsでは、Releaseと物理配布は `production`、Stagingは `staging` のGitHub Environmentに
同名のVariableを設定して、それぞれの統計APIのURLを使います。
未設定のビルドはローカル記録のみで、送信チェックボックスは無効になります。
サービスの作成・secret・allowlist・D1初期化は [Platform APIのセットアップ](https://github.com/koto-thing/GameLauncher/blob/master/services/platform-api/README.md#セットアップ) を参照してください。

ゲームのentrypointが別プロセスを起動してすぐ終了する場合は、その終了までしか観測できません。
ランチャーの完全終了後やゲームEXEの直接起動は対象外です。30秒ごとのcheckpointまでを保存し、
電源断・強制終了後に残った実行中記録は中断として回収します。Windowsでは休止時間を除く
OS単調時計で計測します。Linux/macOSの休止時間の扱いは別途実機確認が必要です。

チュートリアル完了・ステージ到達・ゲームクリアなどはゲーム側イベント連携が必要です。
この初期版の受付契約はプロセス観測に限定し、ゲーム内の進行状況は収集しません。

## Live2D SDK

Cubism SDKはライセンス条件に従い各開発者が準備し、`PANDD_CUBISM_SDK_ROOT` で指定します。SDK本体、モデルの権利対象素材、開発者固有パスをcommitしません。背景モデルの登録、上限、検証方法は [Live2D背景の開発・登録](../LIVE2D_BACKGROUNDS_JA.md) を参照してください。
