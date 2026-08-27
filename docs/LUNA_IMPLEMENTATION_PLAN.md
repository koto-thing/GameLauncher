# GameLauncher 実装計画書

## 1. 文書の目的

この文書は、別タスクのLunaが `D:\Pandd\GameLauncher` を継続実装するための引き継ぎ兼実装計画である

目標は、Windows、macOS、Linuxで動作し、ゲームの取得、インストール、更新、修復、起動と、ランチャー自身の更新を行えるゲームランチャーを完成させることとする

外観だけのモックを先に作って終わらせず、最小の機能を端から端まで動かした後、信頼性と機能を段階的に積み上げる

## 2. Lunaへの最初の指示

1. 最初にルートの `agents.md` とこの文書を全文読む
2. 現在の変更を所有者不明の作業として扱い、無関係な変更を戻さない
3. Phase 0から順番に進め、各Phaseの完了条件を満たすまでは次へ進まない
4. 古い設計を温存する互換層は作らず、不要になった型、経路、実装は削除する
5. UIを別タスクと並行編集する場合は、先に担当ファイルを分ける
6. 各Phase終了時にビルド、テスト、未解決事項を短く報告する
7. 不明点があっても下記の既定値で安全に進められる範囲は止めない

## 3. 現状の確認結果

### 3.1 採用できる土台

- C++20、Qt 6 Widgets、CMakeを使用している
- `domain`、`application`、`infrastructure`、`presentation` の基本ディレクトリがある
- Windows上のDebugビルドは成功する
- 背景画像、左側のゲーム一覧、ゲーム詳細、ストア風画面、設定オーバーレイの外形がある
- 設定保存、ゲーム起動、マニフェスト取得、ファイル取得、ランチャー更新の試作がある
- Qt Testを使ったテストターゲットが5件ある

### 3.2 そのまま製品にできない箇所

- ゲーム一覧と起動先がハードコードされ、実データと接続されていない
- 起動先は現状 `notepad.exe` である
- ダウンロードは直列、上書き保存で、中断再開、速度制限、リトライ、原子的切替がない
- 進捗DTOで受信済みバイトへ総バイト数を代入する不具合がある
- マニフェストの必須値検証、署名検証、パスTraversal対策がない
- MD5を受け入れており、製品用の完全性検証として不適切である
- 設定Repositoryが重複し、UIがRepositoryを直接操作している
- `AppContainer` に所有権を持たない `shared_ptr` があり、寿命管理が不明瞭である
- ランチャー更新にWindows固有の `.exe` パスとダミー互換実装が残っている
- Qt Installer Framework用の構成、パッケージ生成、配布リポジトリ生成がない
- テストは外部GitHubや存在しないドメインへ依存している
- CTestはQt DLLの探索設定不足により、現在は5件すべてプロセス起動前に失敗する
- Doxygenコメントと処理ブロックコメントの規約が既存コード全体に適用されていない
- CMakeに開発者PC固有のQtパスが含まれている

### 3.3 既存コードの扱い

既存コードは参考実装として扱う。完成済みAPIとはみなさない

次の重複や暫定経路は置き換え後に削除する

- `QtSettingsRepository` と `JsonSettingsRepository` の二重実装
- マニフェストURLを受け取るが無視するランチャー更新経路
- `downloadAndApply` と `runMaintenanceTool` の重複した更新経路
- `SettingsPageFactory` からRepositoryを直接変更する経路
- ダミーゲーム、ダミーアプリパス、外部ネットワーク依存テスト

## 4. 確定する技術方針

### 4.1 クライアント

- C++20
- Qt 6 Widgets
- CMakeとCTest
- Qtの公式CMake Deployment APIでランタイム依存物を収集する
- Qt Installer Frameworkのオンライン更新リポジトリとMaintenance Toolでランチャーを更新する
- JSONはQt JSON APIを利用し、新しいJSONライブラリは追加しない
- ローカル状態はJSONを `QSaveFile` で原子的に保存する
- ログはローテーション可能なファイルログとし、機密情報を記録しない
- Qt以外のC++依存関係が必要になった時点でvcpkg manifestへ固定し、端末への手動導入を前提にしない

### 4.2 バックエンド

初期版は常時稼働Application ServerとDatabaseを持たない静的配信方式を採用する

- カタログ、お知らせ、最新release pointerはPublisherが生成するversioned JSONとする
- ゲーム本体、画像、署名済みマニフェスト、ランチャー更新物もCloudflare R2 Standardへ置く
- R2は所有ドメインの `downloads.<domain>` と接続し、Cloudflare Cacheを有効にする
- 公開処理はCIまたは専用Publisher CLIからのみ行い、管理用書込APIは作らない
- ニュースとゲーム情報の原稿はGit管理し、Review後にPublisherでJSONへ変換する
- ローカル開発はfixtureとローカルHTTPサーバーだけで完結させる
- 利用者Account、購入権限、非公開配布、Web管理画面が必要になるまで動的APIとDatabaseを追加しない

初期リリースに利用者アカウント、課金、ソーシャル機能、テレメトリは含めない

### 4.3 配布方式

- Windows x86_64は未署名オンラインインストーラー `.exe` と検証済みSHA-256を公開する
- macOSはx86_64とarm64を対象とし、Developer ID署名、公証、Staple済み成果物を配布する
- Linux x86_64はQt Installer Frameworkの実行形式インストーラーを配布する
- 初期インストーラーにはゲーム本体を含めない
- インストーラーにはランチャー、Qtランタイム、Maintenance Tool、アンインストーラーだけを含める
- Linuxのdeb、rpm、Flatpak、AppImageとWindows ARM64は初期スコープ外とする

QtとQt Installer Frameworkの利用条件は、製品の公開形態を決める前にユーザーが公式条件と専門家の助言により確認する

### 4.4 推奨インフラ構成

所有するUbuntuレンタルサーバーは、Publisher実行、backup、管理作業へ任意で利用する。ランチャーの通常動作はこのサーバーへ依存させず、大容量配布物も置かない

```text
Launcher
  |-- Staging build
  |     `-- downloads.koto-thing.com --- Cloudflare Cache --- R2 staging bucket
  |
  `-- Production build
        `-- downloads.pandd.org ------- Cloudflare Cache --- R2 production bucket

Developer or CI
  `-- Publisher CLI --------> private R2 S3 API

Ubuntu Rental Server
  |-- optional Publisher runner
  `-- encrypted off-site metadata backup
```

- 確認環境は `downloads.koto-thing.com`、本番環境は `downloads.pandd.org` を使う
- R2 bucket、書込credential、manifest署名鍵、固定公開鍵を確認環境と本番環境で分離する
- 確認buildは画面へ常時 `STAGING` を表示し、本番buildへ自動昇格させない
- 本番buildは `downloads.pandd.org` と本番署名鍵だけを信頼し、利用者が接続先を変更する設定を作らない
- `koto-thing.com` と `PandD.org` のDNS zoneをCloudflareへ追加する
- Domain registrarを移管する必要はなく、DNS nameserverだけをCloudflareへ設定する
- レンタルサーバーの契約種別や権限はPhase 0を開始する条件にしない
- Publisher runnerとして使う場合だけ、SSH、利用可能Disk、backup方法を確認する
- ゲーム配布はCloudflare R2 Standardを第一候補とする
- R2の `r2.dev` URLは開発専用とし、本番では所有するCustom Domainを使う
- Custom Domain側でCache EverythingとSmart Tiered Cacheを設定する
- Artifact URLはcontent hashを含む不変URLとし、長いCache-Controlを設定する
- catalog、latest pointer、announcementは短いcacheまたは再検証を設定する
- R2の本番bucketへ人手で直接上書きせずPublisherだけに書込権限を与える
- `r2.dev` accessを無効化し、Custom Domain側でWAFと費用alertを設定する

Cloudflare R2 Standardは2026年8月時点でStorageがUSD 0.015/GB-month、Internet egressが無料である。実契約時は必ず最新価格を再確認する

CloudflareのFree、Pro、Businessにおける一オブジェクトのcache上限は512 MBであるため、Publisherは大容量ゲームファイルを64 MiBから256 MiBのcontent-addressed chunkへ分割する。これによりcache、再試行、版間再利用も安定させる

Cloudflareを採用できない場合の第二候補はBackblaze B2とCDNの組合せとする。2026年8月時点でB2はUSD 6.95/TB-monthから、月間平均保存量の3倍までegress無料であるが、配布量が保存量を大きく超えるゲーム配布ではR2の方が費用を予測しやすい

#### 想定利用量に対する概算

ユーザー回答の最大5 GB、月間1,000回の完全downloadを上限寄りの例とする

- 月間転送量は約5 TB
- R2からInternetへのegress費用はUSD 0
- 5 GBを256 MiB chunkにすると約20 objectであり、1,000回の完全downloadでも約20,000 GETである
- R2 Standardの無料枠は10 GB-month、Class A 100万request、Class B 1,000万requestである
- 最新5 GBと直前版5 GBだけならStorageも概ね無料枠内である
- 保存量20 GBなら無料枠控除後のStorage概算は月額USD 0.15
- 保存量50 GBなら無料枠控除後のStorage概算は月額USD 0.60
- 保存量100 GBなら無料枠控除後のStorage概算は月額USD 1.35

税、為替、Cloudflareの料金変更、追加serviceは含まない。現状規模では既存serverとdomainの固定費を除き、配布backendを月額数十円から数百円程度に抑えられる見込みである

### 4.5 署名証明書の準備方針

#### Windows

- Windows成果物は未署名で公開し、SmartScreenの「不明な発行元」警告を配布ページへ明記する
- ランチャーZIPとオンラインインストーラーへSHA-256 sidecarを付け、CIで生成直後に再検証する
- コード署名は将来予算と発行条件が整った場合に、新しいリリース要件として検討する

#### macOS

- Apple Developer Programへ個人名義で加入する
- 配布者名はAppleで確認された個人の法的氏名になる
- 個人加入のためD-U-N-S Numberは不要である
- app bundle用のDeveloper ID Applicationを用意する
- pkg形式を使う場合はDeveloper ID Installerも用意する
- macOS CI runnerでHardened Runtimeを有効にし、内側の実行物から外側のbundleへ順に署名する
- `notarytool` で公証し、成功後に `stapler` でticketを添付する
- CIで `codesign --verify`、`spctl`、公証結果を検証する

Windowsの未署名方針はmacOSの署名・公証要件を緩和しない

### 4.6 Qtオープンソースライセンス方針

QtはCommunity EditionのLGPLv3条件で利用し、法的判断が必要な箇所は公開前に専門家またはQtへ確認する

- LauncherはLGPLv3で利用可能なQt moduleだけを使用する
- Qt libraryは動的linkとし、Launcherへ静的linkしない
- 使用moduleと各moduleの正確なlicenseをversion固定時に監査する
- GPL-only moduleを追加する場合はLauncher全体のlicenseへの影響を確認し、無断で追加しない
- 配布物へLGPLv3全文、Qtの著作権表示、使用module一覧、第三者license一覧を同梱する
- 使用したQtの完全な対応sourceまたは有効なsource提供方法を用意する
- Qtを変更した場合は変更を含む対応sourceを提供する
- 利用者がQt共有libraryを交換して再linkした成果物を実行する権利を利用規約で制限しない
- library交換手順を文書化し、macOSではlocal再署名を含む検証手順を用意する
- `THIRD_PARTY_NOTICES.md` と `licenses/` をrelease成果物から自動生成する
- Qt Installer Frameworkは使用versionの `LICENSE.GPL3-EXCEPT` と生成物への適用条件を公開前に個別確認する
- Open Source版とCommercial版のQtを同じprojectで混在させない

この節は法的助言ではない。LGPLv3本文、各moduleのlicense、Qt Installer Frameworkのlicense exceptionをreleaseごとに確認する

## 5. 対象範囲と既定値

### 5.1 対象範囲

- 管理対象ゲームのカタログ表示
- インストール済みゲームの左サイドバー表示
- ゲームごとの一枚背景画像
- お知らせと更新履歴
- 新規インストール、更新、検証、修復、アンインストール、起動
- 中断再開、速度制限、空き容量確認、チェックサム検証
- ランチャー自身の確認と更新
- 設定画面
- Windows、macOS、Linux向けインストーラーとCI成果物
- コンテンツ配信用バックエンドと公開ツール

### 5.2 初期スコープ外

- 任意のPCアプリを自動検出する機能
- ユーザーアカウントとログイン
- ゲーム内課金
- フレンド、チャット、コミュニティ
- P2P配布
- バイナリ差分パッチ
- 複数更新チャンネル
- 自動収集テレメトリ
- ゲームプロセス実行中のゲームファイル更新

### 5.3 質問へ回答がない場合の既定値

- 左側一覧は、このランチャーが管理するインストール済みゲームのみを表示する
- 対応言語は日本語と英語から開始する
- リリースチャンネルはstableのみとする
- ゲーム更新は起動ボタンを押した時に確認し、更新必須なら更新完了後に起動する
- ランチャー自動更新は有効を既定値とし、適用前に更新内容を表示する
- ゲーム実行中は同じゲームの更新を禁止する
- 一つのゲームにつき一つのインストール先だけを管理する
- 背景画像はゲームごとに一枚とし、失敗時は同梱プレースホルダーを表示する
- 公開静的Endpointは認証不要、配布物は署名済みとする

### 5.4 ユーザー回答により確定した事項

- 左サイドバー下部へゲームカタログボタンを固定表示する
- カタログボタンから、このランチャーが配布する未導入ゲームの一覧を開く
- ゲームサムネイルをクリックすると、そのゲームの詳細ダウンロード画面へ遷移する
- 左側の通常一覧には、このランチャーが管理するインストール済みゲームだけを表示する
- 初期対応CPUはWindows x86_64、Linux x86_64、macOS x86_64とarm64とする
- レンタルサーバーは用意済みである
- レンタルサーバーのOSはUbuntuである
- 確認用domainは `koto-thing.com`、本番domainは `PandD.org` とする
- 確認用hostは `downloads.koto-thing.com`、本番hostは `downloads.pandd.org` とする
- 一ゲームの通常容量は1 GB以下、3Dゲームは最大4 GBから5 GB程度を想定する
- 月間download人数は最大見積り約1,000人であり、実際はこれより少ない可能性がある
- Object Storage、CDN、Windows署名証明書、Apple Developer IDは未準備である
- Object Storageと署名証明書は一般公開前に導入する
- レンタルサーバーへSSH接続できる
- 更新公開は原則月一回とする
- 公開中releaseに加えて直前releaseを一世代だけ保持する
- 配布者は個人名義とする
- 対象ゲームengineはUnity、Siv3D、Godotとする
- ゲーム起動時の追加引数は原則空とする
- 起動したゲームのmain process終了をゲーム終了として判定する
- Windowsのsave data rootは `%USERPROFILE%\AppData\LocalLow\PandD_org\<gameId>` とする
- QtはCommercial LicenseではなくCommunity EditionのOpen Source License条件で配布する

## 6. 全体構成

```text
GameLauncher/
  apps/launcher/
    src/
      domain/
      application/
      infrastructure/
      presentation/
      bootstrap/
    tests/
  services/distribution-content/
    content/
      catalog/
      announcements/
      releases/
  services/deployment_publisher/
    cmd/services/deployment_publisher/
    internal/package/
    internal/signing/
  packages/contracts/
    schemas/
    examples/
  apps/launcher/installer/
    config/
    packages/
    scripts/
  tests/
    fixtures/
    e2e/
  docs/
```

現在の `src` はPhase 0で `apps/launcher/src` へ移動する。旧パスを残す互換設定は作らない

### 6.1 依存方向

```text
presentation -> application -> domain
infrastructure -> application/domain
bootstrap -> presentation/application/infrastructure
```

- `domain` はQt、HTTP、JSON、OS APIを参照しない
- `application` はユースケースとPortだけを持ち、Widgetを参照しない
- `infrastructure` はPortを実装する
- `presentation` はView、ViewModel、画面状態を持つ
- `bootstrap` だけが具象クラスを生成して接続する
- Repositoryは保存と外部取得に限定し、画面状態や業務手順を持たせない

### 6.2 主なドメイン型

- `GameId`
- `SemanticVersion`
- `GameCatalogEntry`
- `GameRelease`
- `GameFile`
- `InstalledGame`
- `InstallLocation`
- `InstallState`
- `DownloadJob`
- `DownloadPolicy`
- `LauncherSettings`
- `Announcement`
- `LauncherRelease`

文字列のまま扱うと事故につながる識別子、バージョン、パス、チェックサムは値オブジェクトにする

### 6.3 主なPort

- `IGameCatalogRepository`
- `IGameReleaseRepository`
- `IInstalledGameRepository`
- `IFileTransferService`
- `IFileIntegrityService`
- `IGameInstallationService`
- `IGameProcessService`
- `ISettingsRepository`
- `INotificationService`
- `IStartupService`
- `ILauncherUpdateService`
- `IClock`

Portは必要になった時点で追加し、一つの具象クラスしかなく差し替え理由もない内部処理へ形式的なInterfaceを作らない

### 6.4 主なUse Case

- `LoadLauncherUseCase`
- `RefreshCatalogUseCase`
- `SelectGameUseCase`
- `InstallGameUseCase`
- `UpdateGameUseCase`
- `VerifyGameUseCase`
- `RepairGameUseCase`
- `UninstallGameUseCase`
- `LaunchGameUseCase`
- `LoadAnnouncementsUseCase`
- `LoadSettingsUseCase`
- `SaveSettingsUseCase`
- `CheckLauncherUpdateUseCase`
- `ApplyLauncherUpdateUseCase`

UIはUse Caseへコマンドを渡し、変更された画面状態を購読する。UIからRepositoryを直接呼ばない

## 7. ゲーム配布契約

### 7.1 公開静的Endpoint

初期版は動的APIを起動せず、R2へ次のJSONを公開する

```text
GET /v1/catalog/ja-JP/windows/x86_64.json
GET /v1/games/{gameId}/releases/windows/x86_64/latest.json
GET /v1/announcements/ja-JP.json
GET /v1/launcher/releases/ja-JP/windows/x86_64/latest.json
GET /v1/launcher/changelog/ja-JP.json
```

- 成功レスポンスはJSON
- CloudflareとR2の `ETag` と `Cache-Control` を利用する
- 契約versionをURLに含め、未対応versionを暗黙変換しない
- `latest.json`、catalog、announcementは短いcacheまたは条件付き再検証を使う
- versionまたはcontent hashを含むmanifestとartifactはimmutableとして長期cacheする
- JSONが存在しない、破損している、署名不正の場合はクライアント側の安定したError Codeへ変換する
- 時刻はUTCのRFC 3339
- バージョンはSemantic Versioning

### 7.2 ゲームマニフェスト

```json
{
  "schemaVersion": 1,
  "gameId": "sample-game",
  "version": "1.2.3",
  "platform": "windows",
  "arch": "x86_64",
  "minimumLauncherVersion": "1.0.0",
  "engine": "unity",
  "entrypoint": "bin/sample-game.exe",
  "workingDirectory": "bin",
  "arguments": [],
  "saveDirectoryName": "sample-game",
  "totalSize": 123456789,
  "files": [
    {
      "path": "bin/sample-game.exe",
      "size": 123456,
      "sha256": "64-character-lowercase-hex",
      "executable": true,
      "chunks": [
        {
          "offset": 0,
          "size": 123456,
          "sha256": "64-character-lowercase-hex",
          "url": "https://downloads.example.invalid/blobs/sha256/64-character-lowercase-hex"
        }
      ]
    }
  ],
  "publishedAt": "2026-08-10T00:00:00Z",
  "signature": "base64-ed25519-signature"
}
```

- 署名対象は `signature` を除いたCanonical JSONとする
- 公開鍵はランチャーへ固定して同梱する
- マニフェスト署名はlibsodiumのEd25519実装で検証する
- ファイル完全性はSHA-256だけを許可する
- 各fileは順序付きchunkを持ち、小さいfileは一chunk、大きいfileは64 MiBから256 MiB単位に分ける
- chunk URLはSHA-256をkeyにしたcontent-addressedな不変URLとする
- chunkごとのSHA-256を検証してからfileへ組み立て、最後にfile全体のSHA-256も検証する
- MD5とチェックサム省略は拒否する
- 絶対パス、`..`、空パス、重複パス、インストールルート外へ解決されるパスを拒否する
- エントリーポイントはマニフェスト内のファイルでなければならない
- `engine` は `unity`、`siv3d`、`godot` のいずれかとする
- `workingDirectory` はinstall root内へ解決される相対pathだけを許可する
- `arguments` は初期版では空配列だけを許可する
- `saveDirectoryName` は表示名ではなく、release後に変更しないASCIIの安定識別子とする
- Unix系OSでは `executable` がtrueのfileへ必要な実行権限を付ける
- URLはHTTPSかつ許可した配布Hostだけを許可する
- 上限ファイル数、上限パス長、上限ファイルサイズを持たせる

スキーマ変更時は古いスキーマのfallbackを作らず、Publisherとクライアントを同じ契約へ更新する

### 7.3 ローカルのインストール配置

```text
<gameRoot>/
  .launcher/
    installed.json
    active.json
    staging/<operationId>/
    trash/<operationId>/
  releases/<version>/
    <game files>
```

- 新規または更新ファイルは必ず `staging` へ書く
- `.part` ファイルと取得済みバイト数を保持し、HTTP Rangeで再開する
- 全ファイル検証後にreleaseディレクトリへ切り替える
- `active.json` は `QSaveFile` 相当の原子的置換で更新する
- 起動中のreleaseは変更しない
- 切替失敗時は以前のreleaseをactiveのまま残す
- 成功後も直前のreleaseを一つ保持し、次回正常起動を確認後に削除する
- 同一ファイルの再利用は後段で検討し、最初は安全なコピーを使う

### 7.4 インストール状態機械

```text
NotInstalled
  -> Resolving
  -> Downloading
  -> Verifying
  -> Installing
  -> Ready

Ready
  -> CheckingUpdate
  -> Downloading
  -> Verifying
  -> Installing
  -> Ready

Ready
  -> Verifying
  -> Repairing
  -> Ready

Downloading <-> Paused
AnyOperation -> Failed
Ready -> Running -> Ready
```

- 状態遷移はApplication層で一元管理する
- UIは状態からボタン文言と有効状態を決める
- `Failed` はエラーコード、利用者向け文言、再試行可否を持つ
- キャンセルはstagingだけを片付け、activeなreleaseを壊さない

### 7.5 ゲーム起動とsave data契約

#### 共通起動契約

- `IGameProcessService` がplatform別manifestのentrypointをshellを介さず起動する
- `workingDirectory` を明示し、game argumentsは空配列を既定とする
- processはdetachedにせずLauncherがhandleを保持する
- main processの終了signalをゲーム終了として扱う
- ゲーム起動中はLauncher画面を設定に従って隠すか最小化する
- `ゲーム終了後にランチャーを表示` が有効なら終了signal後に画面を復帰する
- game processがcrashした場合も終了として状態を `Ready` へ戻し、非zero exitをlogへ残す
- main processが別processを起動して即終了するbootstrap形式は初期版で非対応とする

#### Engine別entrypoint

- UnityはWindowsのPlayer `.exe`、macOSの `.app`、Linux Player binaryをentrypointとする
- UnityのWindows releaseでは対応する`<ProductName>_Data` directoryと必要DLLを同じmanifestへ含める
- Godotはexportされたplatform別実行fileをentrypointとする
- Siv3Dは配布用実行fileと必要resourceをmanifestへ含める
- macOS app bundleはPlatform Adapterから待機可能な方法で起動し、bundle processの終了を監視する

#### Save data root

表示名変更や翻訳でsave pathが変わらないよう、directoryにはmanifestの `saveDirectoryName` を使う

```text
Windows: %USERPROFILE%\AppData\LocalLow\PandD_org\<saveDirectoryName>
macOS:   ~/Library/Application Support/PandD_org/<saveDirectoryName>
Linux:   ${XDG_DATA_HOME:-~/.local/share}/PandD_org/<saveDirectoryName>
```

- Launcherは子processへ解決済み絶対pathを環境変数 `PANDD_SAVE_DIR` として渡す
- game側は `PANDD_SAVE_DIR` が存在する場合に最優先で使用する
- Launcherだけで第三者engineの保存先は強制できないため、各game buildでこの契約へ対応する
- UnityはCompany Nameを `PandD_org`、Product Nameを `saveDirectoryName` とし、Windowsでは `Application.persistentDataPath` も同じrootになるようにする
- Godotは `user://` の標準位置がWindowsのRoaming配下になるため、正確にLocalLowへ統一する場合は `PANDD_SAVE_DIR` を読むgame側helperを使用する
- Siv3Dも `PANDD_SAVE_DIR` を読み、未設定時だけplatform標準pathへfallbackする
- save dataはgameの更新、修復、アンインストール対象fileへ含めない
- `ツール` 画面からsave data folderを開けるようにする
- 将来Cloud Saveを追加する場合も、このlocal rootを同期元とする

## 8. ダウンロード要件

- `.part` へのストリーミング書込
- chunk単位の再開と、必要な場合のHTTP Rangeによるchunk内再開
- 一時的なネットワーク障害と5xxに対する上限付き指数バックオフ
- 4xx、署名不正、チェックサム不一致を無限再試行しない
- 受信済み、合計、速度、残り時間、ファイル数を通知する
- 設定された総速度上限を全ジョブで共有する
- 同時取得数は初期値3、実装上限4とする
- 取得前に必要容量とstaging余裕分を確認する
- 取得後にサイズとSHA-256を検証する
- Content-Length不明でも安全に進捗表示できるようにする
- OSのスリープ、アプリ終了、再起動後に安全に再開できる状態を保存する
- ProxyはOS設定を利用する
- 証明書検証を無効化する設定は作らない

速度制限はUIだけでなくInfrastructure層の読込量へ実際に適用する

## 9. ランチャー自身のインストールと更新

### 9.1 初回インストール

Qt Installer Frameworkでプラットフォーム別オンラインインストーラーを作る

インストーラーに含めるもの

- GameLauncher本体
- Qtランタイムと必要なPlugin
- 翻訳ファイル
- 既定背景とアイコン
- Maintenance Tool
- アンインストール情報

ゲーム本体、ゲーム用ランタイム、ゲームアセットは含めない

### 9.2 更新確認

- 起動時と設定画面の手動操作から更新を確認する
- 公開JSONのランチャーリリース情報で最新版、必須更新、更新履歴を表示する
- 実際の更新可否とパッケージ取得はMaintenance Toolを正とする
- 公開JSONとQt IFW Repositoryは同じPublisher入力から生成し、バージョン不一致を防ぐ

### 9.3 更新適用

- ランチャーがゲームまたはインストール処理を実行中なら適用を待つ
- Maintenance ToolのOS別実行パスをPlatform Adapterで解決する
- Maintenance Tool起動成功後にランチャーを終了する
- 更新完了後にランチャーを再起動する
- 強制更新時は更新以外の操作を無効にする
- 失敗時はMaintenance Toolのログ場所と再試行導線を表示する

独自の `updater.exe` は作らない。Qt Installer Frameworkと競合する更新経路は削除する

### 9.4 署名

- Windowsは未署名ランチャーZIPとインストーラーへCI検証済みSHA-256を添付する
- macOSはapp内の入れ子コードから外側へ署名し、Hardened Runtimeを有効化して公証する
- Linux成果物はSHA-256と分離署名を公開する
- CIの署名鍵はSecret Storeに置き、リポジトリや成果物ログへ出さない

## 10. UIと設定の機能契約

見た目の詳細はUI担当が変更できるが、画面が扱う状態と操作は以下で固定する

### 10.1 メイン画面

添付された2枚の参考画像から、次の画面遷移とレイアウトを採用する。画像内のロゴ、キャラクター、ゲーム名、SNSロゴなど第三者著作物は製品へ流用せず、レイアウトと操作だけを参考にする

#### 左サイドバー

- 上部へランチャーのブランドアイコンを表示する
- 中央へインストール済みゲームのアイコンを縦に表示する
- ゲームアイコンをクリックすると対象の `GameDetailPage` を開く
- 下部へ区切り線とゲームカタログボタンを固定表示する
- カタログボタンは四角形を組み合わせたLibraryまたはGridアイコンとし、TooltipとAccessible Nameを付ける
- 未インストールゲームは左サイドバーへ表示しない
- 選択中項目は背景、indicator、Focus outlineで判別できるようにする

#### GameCatalogPage

- 左下のカタログボタンをクリックすると `GameCatalogPage` を開く
- 初回表示時はカタログ先頭のゲームを選択する
- 選択ゲームの一枚hero画像を画面全体の背景に表示する
- 背景下部へ黒から透明のgradientを重ね、説明文とカードの可読性を確保する
- 左上へ選択ゲームのロゴ、左下寄りへ短い紹介文を表示する
- 下部へ横並びのゲームサムネイルカードを表示する
- カードにはthumbnail、ゲーム名、選択状態を表示する
- マウスhoverはpreviewだけに使い、クリックで `GameDetailPage(gameId)` へ遷移する
- キーボードでは矢印でカード選択、EnterまたはSpaceで詳細へ遷移する
- カタログ取得失敗時は背景を維持し、再試行ボタン付きのerror panelを表示する
- カタログが空ならゲームが未公開であることを表示する

#### GameDetailPage

- カタログのサムネイルまたは左側のインストール済みゲームを選ぶと `GameDetailPage` を開く
- 選択ゲームの一枚hero画像を全面背景にする
- 左上へゲームロゴ、version label、release title、更新情報への導線を置く
- 左下へbanner一枚と `イベント`、`お知らせ`、`ニュース` の切替panelを置く
- panelの各項目はtitleと公開日を表示し、クリックで詳細を開く
- 右下へ大きな主操作ボタンを置く
- 未導入時の主操作は `ダウンロード`
- 導入済みで最新版なら `ゲーム開始`
- 更新ありなら `アップデート`
- 取得中はpercent、速度、残り時間を表示し、主操作を `一時停止` へ切り替える
- 一時停止中は `再開`、失敗時は `再試行` を表示する
- 主操作の下へ `インストール済みですか？ ゲームの場所を特定` の導線を置く
- 場所を特定する場合はdirectory選択後にmanifestで全体を検証し、正規releaseと一致した時だけ登録する
- 設定、最小化、閉じるボタンは画面右上に固定する
- SNSや外部サイト導線は要件確定まで実装しない

#### ダウンロード確認

- `ダウンロード` を押すと、即時取得せず確認dialogを表示する
- game name、version、download size、install後size、install先、空き容量を表示する
- install先変更と利用規約確認を行えるようにする
- 容量不足または書込権限不足なら開始ボタンを無効にし、理由を表示する
- 開始後は `GameDetailPage` の進捗表示へ戻す

#### 共通表示要件

- 基準canvasは1280 x 720とし、それ以上では比率を保って余白を拡張する
- 最小対応sizeを定義し、小さい画面で主操作が画面外へ出ないようにする
- 背景画像はCropして表示し、顔やロゴを守るfocal pointをcatalog metadataで指定できるようにする
- 背景画像読込中と失敗時は同梱placeholderを表示する
- 画面遷移履歴を持ち、catalogから詳細へ移動した場合は戻る操作でcatalogへ戻す
- キーボード操作、Focus表示、スクリーンリーダー用ラベルを付ける
- 背景上でも読めるoverlayと十分なcontrastを確保する

### 10.2 設定項目

#### クライアント言語設定

- 日本語
- English
- 初回はOS Localeから選択し、未対応なら日本語
- UI文字列をハードコードせずQt翻訳リソースへ集約する
- 可能な画面は即時反映し、即時反映できない項目だけ再起動要求を表示する

#### スタートアップ設定

- OSログイン時に自動起動
- 自動起動時は最小化
- Windows、macOS、LinuxのPlatform Adapterで実装する
- OS設定変更に失敗した場合は保存値だけを成功扱いにしない

#### 終了設定

- 閉じるボタンで終了
- 閉じるボタンで通知領域へ格納
- ゲーム終了後にランチャーを表示
- macOSと通知領域非対応環境では利用可能な選択肢だけを表示する

#### ランチャー更新設定

- 起動時に自動確認
- 自動適用の有効無効
- 今すぐ確認
- 現在版、最新版、最終確認日時
- 必須更新は設定にかかわらず適用を要求する

#### ダウンロード速度

- 無制限
- 上限値
- 単位は利用者表示をMB/s、保存値をbytes/sとする
- 0、負数、過大値を検証する

#### ゲームアップデート

- ゲーム起動前に自動確認
- 他ゲーム実行中もダウンロードを継続
- 自動更新はインストール済みゲームだけを対象にする
- ゲーム実行中はそのゲームを更新しない

#### 通知

- ダウンロード完了
- インストールまたは更新完了
- エラー
- ランチャー更新
- OS通知権限がない場合は設定画面に状態を表示する

#### ツール

- ゲームファイル検証
- 修復
- インストールフォルダーを開く
- 実行ファイルを再指定するのではなく、正規マニフェストから復元する
- ゲームのアンインストール
- 失敗した一時データの削除
- ログフォルダーを開く

#### 詳細

- ランチャーバージョン
- ビルド番号、OS、アーキテクチャ
- 更新履歴
- ライセンス
- プライバシーポリシー
- 利用規約
- 診断情報のコピー

### 10.3 UI担当との境界

並行作業時は次のように分ける

- UI担当は `apps/launcher/src/presentation/views`、`apps/launcher/resources/styles`、`apps/launcher/resources/images`
- 機能担当は `domain`、`application`、`infrastructure`、`server`、`publisher`、`installer`、`contracts`
- `presentation/viewmodels` と画面状態DTOは先に合意してから編集する
- UI担当はRepositoryやネットワーク具象クラスを直接参照しない
- UI試作用データはApplication層のFakeを注入し、本番ハードコードを残さない

## 11. コメントとコード規約

ユーザー指定の規約を全新規・変更コードへ適用する

### 11.1 Doxygenコメント

- 名前を持つすべての関数宣言へDoxygen形式のコメントを付ける
- コンストラクター、デストラクター、演算子、private関数、free関数、テスト関数も対象にする
- コメント末尾へ日本語の句点 `。` を付けない
- `@param` は意味が自明でない引数に付ける
- `@return`、`@throws`、前提条件を必要に応じて書く
- 宣言に詳細を書き、定義側で同じ説明を複製しない

```cpp
/**
 * @brief 指定したゲームの最新リリースを取得する
 * @param gameId 対象ゲームの識別子
 * @return 取得した最新リリース
 */
GameRelease fetchLatestRelease(const GameId& gameId);
```

### 11.2 処理ブロックコメント

- 検証、準備、取得、切替、後処理など、処理のまとまりごとに短いコメントを置く
- コードを日本語へ逐語訳するコメントは避ける
- コメント末尾へ `。` を付けない

```cpp
// マニフェストと保存先を検証
validateManifest(manifest);
validateInstallRoot(installRoot);

// 検証済みファイルを有効リリースへ切り替え
activateRelease(release);
```

### 11.3 その他

- `clang-format` をリポジトリに置き、CIで差分を検査する
- `clang-tidy` は警告集合を固定し、CIとローカルで同じ設定を使う
- Doxygenを警告有効で実行し、未文書化関数をCIで検出する
- ProductionコードにTODOを残さない
- ログ、エラー、UI文字列は責務ごとに分ける
- 例外と結果型の方針をApplication境界で統一する

## 12. 実装Phase

### Phase 0 基準線の修復

作業

- CMakeのPC固有 `CMAKE_PREFIX_PATH` を削除し、CMake Presetsまたは環境からQtを解決する
- Application本体とテスト用ライブラリへターゲットを分割する
- CTestでQt DLLまたは共有ライブラリを探索できるようにする
- 外部インターネット依存テストをローカルfixture HTTPサーバーへ変更する
- 現在の5テストを意味のある成功または明示的失敗にする
- Windows、macOS、LinuxのCI build matrixを作る
- `clang-format`、Doxygen、基本静的解析を追加する
- `src` を `apps/launcher/src` へ一度で移動し、古いパスを削除する

完了条件

- 3 OSでconfigureとbuildが成功する
- CTestが環境依存の起動失敗を起こさない
- テストが公開インターネットへ接続しない
- 開発者固有絶対パスがBuild設定にない

### Phase 1 一つのゲームを端から端まで動かす

作業

- 契約スキーマとfixtureを作る
- 一ゲームだけ返すfixture JSONとローカルHTTPサーバーを作る
- カタログ取得とインストール済み状態を実装する
- 安全な単一ファイル取得、SHA-256検証、staging、active切替を実装する
- 左一覧へインストール済みゲームを表示する
- 未インストールゲームをインストールし、正規entrypointを起動する
- ダミーゲームとnotepad起動を削除する

完了条件

- 空の端末状態から、一覧取得、インストール、検証、起動まで手動操作で完了できる
- 取得失敗時に既存の正常インストールを壊さない
- 再起動後もインストール状態が復元される
- Phase 1フローのApplicationテストとE2Eテストがある

### Phase 2 信頼できるゲーム更新エンジン

作業

- 複数ファイルと複数ゲームへ拡張する
- Publisherで大容量fileをcontent-addressed chunkへ分割し、クライアントで安全に再構成する
- Range再開、リトライ、並列取得、速度制限を実装する
- 署名付きマニフェスト検証を実装する
- 空き容量、パス、URL、サイズ上限を検証する
- 更新、検証、修復、キャンセル、失敗復旧を実装する
- 旧release保持と安全な清掃を実装する
- ゲームプロセス監視と更新排他を実装する
- Unity、Godot、Siv3Dのfixture executableで起動、終了、crash、画面復帰を検証する
- `PANDD_SAVE_DIR` のplatform別解決と子processへの引継ぎを実装する

完了条件

- 通信切断とアプリ再起動後に途中から再開する
- 破損ファイルを検出し必要ファイルだけ修復する
- 不正署名、パスTraversal、SHA不一致を拒否する
- 更新失敗後も以前の版を起動できる
- 設定した速度上限が統合テストで許容誤差内に収まる

### Phase 3 設定と製品UIの接続

作業

- 設定Repositoryを一つへ統合する
- ViewModelと画面状態を導入し、UIからRepository直接参照を削除する
- 指定された全設定カテゴリを実装する
- 言語切替、OSスタートアップ、通知領域、通知を接続する
- 一枚背景、左一覧、お知らせ、進捗、エラー導線を本番データへ接続する
- キーボード操作、Focus、読み上げラベル、高DPIを確認する

完了条件

- 全設定が保存、再読込、UI反映される
- OS設定適用失敗が利用者へ通知される
- 日本語と英語で文字切れがない
- UIにダミーデータ、ダミーURL、ダミー実行先がない

### Phase 4 静的バックエンドと公開パイプライン

作業

- カタログ、リリース、お知らせ、ランチャー更新履歴のsource schemaと公開JSON schemaを実装する
- Publisher CLIでfile走査、chunk分割、SHA-256計算、manifest署名、R2 uploadを行う
- 公開順を `artifacts -> immutable manifest -> latest pointer` とし、途中状態を参照させない
- Content-Type、ETag、Cache-Controlをobject種別ごとに設定する
- `downloads.pandd.org`、Cloudflare Cache、WAF、R2 lifecycleを設定する
- `downloads.koto-thing.com` とstaging bucketで本番前確認を行う
- 公開前に署名、参照先object、合計sizeをPublisher自身が検証する
- 定期releaseは原則月一回とする。ただしsecurityまたは致命的不具合の修正は待たない
- currentとpreviousの二releaseだけを公開保持対象とする
- currentとpreviousのどちらからも参照されないblobだけを、latest切替から7日以上の猶予後に削除する

完了条件

- 一コマンドまたは一CI jobでゲームreleaseを公開できる
- 失敗した公開はlatestへ昇格しない
- 同じ入力の再実行が安全である
- Publisher契約テストがクライアントfixtureと同じschemaを使う
- R2障害またはupload失敗時に旧latest pointerが維持される
- 動的API、Database、管理画面が初期成果物へ含まれていない

### Phase 5 ランチャーのインストールと自己更新

作業

- Qt公式CMake Deployment APIへ移行する
- Qt Installer Frameworkのconfig、package、component scriptを作る
- 3 OSのオンラインインストーラーを生成する
- `repogen` で更新Repositoryを生成する
- Launcher releaseと更新履歴をPublisherへ追加する
- Maintenance Toolの確認、適用、再起動をPlatform Adapterで実装する
- Windows checksum、macOS署名・公証・staple、Linux分離署名をCIへ追加する

完了条件

- クリーン端末へインストールできる
- ゲーム本体がインストーラーに含まれていない
- 旧ランチャーから新ランチャーへ更新し、設定とゲーム情報が保持される
- 更新失敗時にランチャーまたはMaintenance Toolを再実行できる
- アンインストールでランチャーを削除し、ゲーム削除は利用者へ明示確認する

### Phase 6 3 OSの製品化

作業

- Windowsスタートアップ、通知、checksum、SmartScreen警告、インストールを実機確認する
- macOS Login Item、通知、app bundle、署名、公証を実機確認する
- Linux autostart、通知、desktop entry、インストールを対象Distributionで確認する
- OS別の標準保存先、権限、パス長、大文字小文字差を確認する
- macOS Intel、Apple Siliconの成果物を確認する
- Linuxのglibc互換範囲をビルド環境で固定する

完了条件

- 対象OSのクリーンVMまたは実機でインストール、起動、ゲーム取得、更新、自己更新、アンインストールが通る
- 一般ユーザー権限で通常操作が完結する
- Windows checksum、macOS公証、またはLinux分離署名の検証が成功する

### Phase 7 リリース品質

作業

- 破損manifest、低速回線、切断、満杯disk、権限不足、強制終了をFault injectionで試験する
- 複数回起動を単一Instanceへ制御する
- ログローテーションと診断情報コピーを実装する
- 依存関係とライセンス一覧を生成する
- バックアップ、release rollback、配布停止手順を文書化する
- インシデント時の強制更新と壊れたreleaseの無効化を試験する

完了条件

- Release checklistが全項目成功する
- CriticalまたはHighの既知不具合がない
- 復旧手順を別端末で再現できる

## 13. テスト方針

### 13.1 Unit Test

- Semantic Version比較
- manifest validation
- 安全なパス解決
- インストール状態遷移
- 更新対象ファイル判定
- 設定validation
- 速度制限計算
- retry policy

### 13.2 Integration Test

- ローカルHTTPサーバーから正常取得
- Range再開
- 途中切断と5xx retry
- 4xx打切り
- SHA不一致
- 署名不正
- stagingからactiveへの切替
- 空き容量不足
- 設定の原子的保存
- Publisherが生成した静的JSONとR2互換Object Storage

### 13.3 E2E Test

- 新規インストールから一ゲーム起動
- ゲームの更新と修復
- ランチャー自己更新
- アンインストール
- OS再起動後の自動起動
- 通知領域からの復帰
- 日本語と英語切替

テストは外部の公開URLへ依存させず、固定fixtureとローカルサーバーで再現可能にする

## 14. CI/CD

Pull Requestごとに実行する

- format check
- Doxygen check
- static analysis
- client buildとCTestの3 OS matrix
- Publisher Unit Test
- contract test
- secret scan

mainへの統合後に実行する

- 3 OSの署名前成果物
- ローカルfixtureを使うインストーラーE2E
- SBOM生成

version tagで実行する

- Release build
- OS別コード署名
- macOS公証とStaple
- Qt IFW Repository生成
- Object Storageの一時prefixへupload
- smoke test
- latest pointerの原子的昇格
- 更新履歴の公開
- Qt LGPL、Qt IFW、第三者license成果物の生成と監査

署名やupload権限がないPull Requestから本番release jobを実行できないようにする

## 15. セキュリティ要件

- HTTPSを必須にする
- ManifestへEd25519署名を付け、クライアントの固定公開鍵で検証する
- ArtifactはSHA-256で検証する
- 許可Host以外から取得しない
- 保存先を正規化し、install root外への書込を拒否する
- symlink、junction、reparse pointを使った脱出を検査する
- archiveを扱う場合は展開後パスと展開後総容量を制限する
- ゲーム起動引数をサーバー文字列からshellへ渡さず、引数配列としてプロセスAPIへ渡す
- R2の公開読取経路とPublisherの書込credentialを分離する
- 署名鍵をCI Secret Storeで管理する
- ログへtoken、署名鍵、個人パスの不要部分を記録しない
- 依存関係の脆弱性検査とSBOM生成を行う

## 16. データ保持とアンインストール

- Launcher設定はOS標準のApplication Data領域へ保存する
- インストール状態はLauncher設定とゲームroot内metadataの双方から整合確認する
- cache、staging、log、game dataを区別する
- ランチャーのアンインストール時にゲーム本体を暗黙削除しない
- ゲーム削除は対象パスと容量を表示して明示確認する
- save dataはmanifest上でゲーム本体と区別し、既定では削除しない
- 削除失敗時は残った正確なパスを表示する

## 17. 可観測性とエラー設計

- エラーは安定したError Codeとlocalized messageを分ける
- 利用者向けには次に取れる操作を示す
- 詳細ログにはoperation ID、game ID、release、HTTP status、再試行回数を含める
- ダウンロードURLのquery tokenはログから除去する
- Cloudflare responseのRay IDを取得できる場合はnetwork errorの診断情報へ含める
- 初期版では利用者端末からログを自動送信しない

代表Error Code

```text
NETWORK_OFFLINE
DOWNLOAD_HTTP_ERROR
DOWNLOAD_RANGE_UNSUPPORTED
MANIFEST_INVALID
MANIFEST_SIGNATURE_INVALID
FILE_HASH_MISMATCH
DISK_SPACE_INSUFFICIENT
INSTALL_PERMISSION_DENIED
GAME_ALREADY_RUNNING
LAUNCH_EXECUTABLE_MISSING
LAUNCHER_UPDATE_FAILED
```

## 18. 完了定義

機能は次をすべて満たした時だけ完了とする

- 要件に対応するProductionコードがある
- 正常系と主要異常系の自動テストがある
- Windows、macOS、LinuxのCIが通る
- 名前を持つ関数へDoxygenコメントがある
- 処理ブロックへ簡潔なコメントがある
- UI文字列が翻訳対象になっている
- ログと利用者向けエラーがある
- 仮URL、ダミーデータ、TODO、互換用死骸がない
- 文書と契約schemaが実装と一致する
- 署名済み成果物または署名前CI成果物として再現可能に生成できる

## 19. 着手時の未確定事項

実装開始を妨げる未確定事項はない。次は各機能の接続時に確認すればよい

1. `koto-thing.com` と `PandD.org` をCloudflare DNSへ接続できる権限
2. 最初に配布するgameの安定した `gameId` と `saveDirectoryName`
3. 最初に配布するgameのplatform別build成果物
4. 公開時に使用する個人名義Windows証明書とApple Developer Program
5. Qt、Qt Installer Framework、第三者componentの最終license監査結果

## 20. 参考にする公式資料

- Qt Installer Framework Overview: https://doc.qt.io/qtinstallerframework/ifw-overview.html
- Qt Installer Framework Promoting Updates: https://doc.qt.io/qtinstallerframework/ifw-updates.html
- Qt CMake Deployment API: https://doc.qt.io/qt-6/qt-generate-deploy-app-script.html
- Qt Supported Platforms: https://doc.qt.io/qt-6/supported-platforms.html
- Apple Notarization: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Microsoft Code Signing: https://learn.microsoft.com/windows/security/application-security/application-control/app-control-for-business/deployment/use-code-signing-for-better-control-and-protection
- Microsoft SignTool: https://learn.microsoft.com/windows/win32/seccrypto/signtool
- Microsoft Artifact Signing FAQ: https://learn.microsoft.com/azure/artifact-signing/faq
- Apple Developer Program Membership: https://developer.apple.com/jp/programs/whats-included/
- Apple D-U-N-S Number: https://developer.apple.com/help/account/membership/D-U-N-S
- Cloudflare R2 Pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 Public Buckets and Custom Domains: https://developers.cloudflare.com/r2/buckets/public-buckets/
- Cloudflare R2 Cache: https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/
- Backblaze B2 Pricing: https://www.backblaze.com/cloud-storage/pricing
- Qt Open Source LGPL Obligations: https://www.qt.io/development/open-source-lgpl-obligations
- Qt 6 Licensing: https://doc.qt.io/qt-6/licensing.html
- Qt Installer Framework GPL Exception: https://github.com/qtproject/installer-framework/blob/master/LICENSE.GPL3-EXCEPT
- Unity Application.persistentDataPath: https://docs.unity3d.com/ScriptReference/Application-persistentDataPath.html
- Godot File Paths: https://docs.godotengine.org/en/stable/tutorials/io/data_paths.html
- Siv3D File System: https://siv3d.github.io/en-us/tutorial3/filesystem/
