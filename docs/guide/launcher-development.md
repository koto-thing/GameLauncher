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

公開C++ APIはDoxygen target `docs-check` でも検証され、未文書化警告をエラーとして扱います。

## Live2D SDK

Cubism SDKはライセンス条件に従い各開発者が準備し、`PANDD_CUBISM_SDK_ROOT` で指定します。SDK本体、モデルの権利対象素材、開発者固有パスをcommitしません。背景モデルの登録、上限、検証方法は [Live2D背景の開発・登録](../LIVE2D_BACKGROUNDS_JA.md) を参照してください。
