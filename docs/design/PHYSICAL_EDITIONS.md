# Windows物理配布版ランチャー

## 確定仕様

- Control-Planeで管理ゲームを一覧表示し、Windows x86_64の本番公開版があるゲームを選択する
- 配布版ごとに名前、ロゴ、背景画像、アクセントカラーと収録対象を固定する
- GitHub Actionsがビルドの最初に各ゲームの最新本番manifestを保存し、以降はその署名済みmanifestのみから配布物を組み立てる
- 配布物はSetup.exeとmediaフォルダーを一緒に収める。両方を同じ場所に置き、USB・ディスク等で配布する
- ランチャーは必須、収録ゲームはインストーラーで選択する。初回導入と起動にログイン、キー、ネット接続は不要
- 未導入の収録ゲームはオンラインまたは配布媒体から追加できる。収録対象外は追加・更新・起動できない
- ゲームは通常版と同じ本番公開版へ更新する。古い媒体で導入済みゲームをダウングレードしない
- ランチャー自身は共通のIFW更新を受け取り、配布情報とデザインは維持する
- 通常版と各配布版はアプリ、設定、ゲーム保存先、単一起動制御、自動起動登録、ショートカットを分離する
- ゲーム独自のセーブ先は従来仕様を維持する。ゲーム側が独自に固定した保存先をランチャーから強制分離しない

## 実装の境界

`EditionProfile`は署名付きedition.jsonと各同梱ファイルのSHA-256を検証する。固定情報を共通ランチャーの更新対象から分離し、破損時は通常版に切り替えず停止する。ゲームmanifestには既存のEd25519検証を適用する

`LauncherService::installFromMedia`は既存のGameInstallationService::importExistingを使用し、検証済みファイルだけをstagingから有効化する。IFWのゲームcomponentはこの処理を呼ぶための選択項目であり、可変ゲームファイルを所有しない。ゲームの追加・削除・更新操作はランチャーから行う

IFW 4.7は`--offline-only`を使用し、初回はネット接続せず、導入後は共通のWindows更新repositoryを使う。4.7のオフライン制限は初回インストーラーにのみ適用され、メンテナンスツールの更新接続は制限しない。`org.pandd.edition`が固定情報と専用ショートカットを所有し、`org.pandd.launcher`が共通エンジンを所有する

Control-Planeの`/editions`は既存の管理者認証で利用する。現行のProduction Actions設定を再利用する。新規テーブルはphysical_editionsとphysical_edition_builds。デザイン画像は非公開INTAKE R2のphysical-editions配下に保存する。各ビルドはOIDCでrepository、master、専用workflow、production environment、run IDとattemptを検証する

作成済み配布版を編集するAPIは設けない。同じ固定内容を再ビルドする場合も新しいbuild IDを発行する。Actions画面からの「Re-run」は既存build IDに再接続できないため、Control-Planeから新しいビルドを依頼する

## 運用

1. 管理画面と専用workflowを通常のリリース手順で反映する
2. GitHub production Environmentに既存のMANIFEST_PUBLIC_KEY_BASE64、MANIFEST_PRIVATE_KEY_PEM、および通常版のCubism設定を用意する
3. DEPLOYMENT_CONTROL_PLANE_URL、GitHub App設定、PRODUCTION_DISPATCH_ENABLEDを既存設定と同様に有効にする
4. `/editions`で収録ゲームとPNG画像（各2 MiB以下、4096×4096以内）を設定して保存する
5. ビルド完了後にActions artifactを取得し、展開したSetup.exeとmediaフォルダーを一緒に配布媒体へコピーする

Actions artifactの保存期間は90日。物理配布用の完成データは運営側で保管する。完成物の同梱バージョンはbuild-info.jsonとControl-Planeのビルド履歴で確認する

共通ランチャー更新の公開には通常版のリリース手順を使う。配布版対応コードが含まれた通常版だけを以降の更新として公開する

## 検証

- Python: `python -m unittest scripts.editions.test_build apps.launcher.installer.test_build`
- TypeScript: admin-webで`node --test tests/physical-edition.test.mjs`、型チェック、lint、本番ビルド
- C++: LauncherIntegrationStateTestsで実ファイルの媒体導入・状態復元・対象外拒否・ダウングレード防止・破損拒否・オフライン起動を検証
- IFW: `python -m scripts.editions.e2e --ifw-root <IFW> --fixture <GameProcessFixture.exe>`で選択導入と共通エンジン更新後の固定情報保持を検証

実サービスへのデプロイ・Actions起動は、ローカル実装の検証とは別に行う

### ローカル検証結果

Windowsビルド、C++の4テストスイート、管理画面の89テスト、Pythonの15テスト、型チェック・lint・本番ビルドを確認。実際のQt IFW 4.11で選択インストールと共通ランチャー更新後の配布情報保持を確認した。Actionsは通常版と同じIFW 4.7を使用するため、CI環境での初回確認は別途必要

ローカルの管理画面から本番ゲーム一覧取得、画像アップロード、収録対象の保存・再取得、管理者以外の拒否を確認した。Actions用API単体のWorkerでは未認証リクエストを401で拒否する。一方、Vinextの本番ビルドをWrangler 4.127.0で実行し、管理画面操作後にActions APIを呼ぶとローカルWorkerがNetwork connection lostで停止する現象がある。既存のゲーム公開APIでも再現したため、実ActionsのOIDC連携は未検証として扱う

Doxygenがローカルにないためdocs-checkは未実行。公開前にCIのドキュメント検証と実Actionsでの配布版ビルドを確認する

## 参照

- [Qt IFWのオフライン／hybridインストーラー](https://doc.qt.io/qtinstallerframework/ifw-offline-installers.html)
- [Qt IFW component scripting](https://doc.qt.io/qtinstallerframework/scripting.html)
- [Qt IFW更新repository](https://doc.qt.io/qtinstallerframework/ifw-updates.html)
