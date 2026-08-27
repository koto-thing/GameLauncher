# 次エージェント向け指示書: npm更新とGitHub Pagesドキュメントポータル

## 依頼内容

次の順序で作業すること。

1. `apps/admin-web`のnpm依存関係を安全にアップグレードする
2. 現在のMarkdownドキュメントを整理し、GitHub Pagesで閲覧できるドキュメントサイトを作る
3. Game LauncherとAdmin Webの開発・テスト・デプロイ手順を掲載する
4. LauncherのコードリファレンスとAdmin Web HTTP APIリファレンスを掲載する
5. GitHub Pagesへ実際にデプロイし、公開URLを検証する

Store、Community、Platform APIの実装にはまだ着手しない。

## 必ず守るリポジトリ方針

- 1つのモノレポを維持する
- 一般利用者、配信、運営の3つの信頼環境を混ぜない
- 互換用の旧パス、リダイレクト、複製ファイルを追加しない
- 現在の正しいパスだけを使用する
- 最小構成を完成させてから機能を追加する
- 秘密値、`.env`、署名鍵、R2資格情報、presigned URLをドキュメントへ掲載しない
- ユーザーの既存変更を破棄しない
- `git reset --hard`や`git checkout --`を使用しない

設計上の正は次の2ファイル。

- `docs/PLATFORM_ARCHITECTURE_JA.md`
- `infrastructure/trust-boundaries.json`

## 現在のモノレポ構成

```text
apps/
  admin-web/             Cloudflare上の運営用Control Plane
  community-web/         将来実装。現在はREADMEのみ
  intake-uploader/       Legacyのデスクトップ入稿ツール
  launcher/              C++ / QtランチャーとInstaller
  store-web/             将来実装。現在はREADMEのみ

services/
  deployment_publisher/  検証・署名・R2公開処理
  distribution-content/  公開前のLauncherコンテンツ
  platform-api/          将来実装。現在はREADMEのみ

packages/
  contracts/             canonical JSON Schema

modules/                 業務モジュール境界
infrastructure/          信頼環境の所有定義
docs/                    現行Markdown文書
scripts/                 CI、公開、ローカル実行スクリプト
```

旧パスの`client/`、`backend/`、`publisher/`、`installer/`、`contracts/`、
`apps/control-plane/`は削除済み。旧パスを復活させないこと。

## 現在確認済みの状態

前回作業では次が成功している。

- `apps/admin-web`: production build成功
- `apps/admin-web`: Nodeテスト78件成功
- `apps/admin-web`: ESLint成功
- Pythonテスト: 64件中63件成功、OpenSSL CLI不在による1件skip
- LauncherとLive2DのMSVC v143ビルド成功
- CTest 5件成功
- 3信頼環境の構成検証成功

`npm ci`実行時に2件のHigh severity vulnerabilityが報告されたため、これを先に解消する。

## Phase 1: npm依存関係の更新

対象は最初に`apps/admin-web`だけとする。ドキュメントサイトの依存関係は別Packageとして管理する。

### 調査

```powershell
Set-Location apps/admin-web
npm outdated
npm audit
npm audit --json
```

監査結果について、脆弱な直接依存、推移的依存、到達可能な実行経路、修正版を確認する。
`npm audit fix --force`を無条件に実行してはいけない。

### 更新方針

- 直接依存は公式リリースノートと移行ガイドを確認する
- Cloudflare、Vinext、Vite、React、Drizzle、Jose、Ajvの互換性を確認する
- lockfileだけでなく`package.json`の意図したバージョンも更新する
- 廃止済みAPIや不要なoverrideは削除する
- 脆弱性を隠すためのaudit除外を追加しない
- 依存関係を更新したら、脆弱性の原因と解消内容を記録する

### 必須検証

```powershell
Set-Location apps/admin-web
npm ci
npm audit
npm run lint
npm test
```

合格条件:

- High/Critical vulnerabilityが0件
- production build成功
- Nodeテスト全件成功
- ESLint成功
- `package-lock.json`が`package.json`と同期している

High/Criticalが上流未修正で残る場合は、依存経路、実行時到達可能性、代替パッケージ、
上流Issueを調査し、勝手に無視せずユーザーへ報告する。

## Phase 2: ドキュメントサイト

### 推奨構成

`apps/docs/`へVitePressベースの静的サイトを作る。Admin WebとはPackageとlockfileを分離する。
GitHub Pagesは静的成果物だけを配信し、Worker、D1、R2、秘密情報へBindingしない。

```text
apps/docs/
  package.json
  package-lock.json
  src/
    index.md
    guide/
      launcher-development.md
      launcher-release.md
      game-deployment.md
      admin-web-development.md
      admin-web-deployment.md
      operations.md
    architecture/
      platform.md
      trust-boundaries.md
    reference/
      launcher-api.md
      admin-api.md
      schemas.md
    public/
```

既存`docs/*.md`を大量にコピーしない。原本を1つに保つため、次のどちらかに統一する。

1. 現在の`docs/`をVitePressのsource directoryとして利用する
2. `apps/docs/src/`へ文書を一度で移し、すべての参照を更新する

中途半端な複製や同期スクリプトは作らない。既存運用文書が多いため、最初は案1を優先して検討する。

### サイトに必要なページ

- PandD Platform概要
- モノレポのディレクトリ構成
- ローカル開発環境の準備
- Launcherの構成、ビルド、実行、テスト
- Live2D SDKの準備とライセンス上の注意
- LauncherのStaging/Production公開
- ゲームArtifact作成とデプロイ
- Admin Webのローカル起動、テスト、Cloudflareデプロイ
- Intake、Staging、Productionの信頼境界
- 障害対応、ロールバック、監査
- JSON Schema一覧
- APIリファレンス
- セキュリティポリシー、利用規約、プライバシーポリシー、ライセンス

古い計画文書と現在の運用手順を同列に表示しない。
`LUNA_IMPLEMENTATION_PLAN.md`などの履歴・計画資料は「Archive」へ分けるか、サイトナビゲーションから外す。

## Phase 3: APIリファレンス

### Launcher C++ API

既存CMakeにはDoxygenターゲットがある。

```cmake
doxygen_add_docs(docs-check apps/launcher/src ...)
```

これを利用し、公開用Doxygen HTMLをGitHub Pages成果物の`reference/cpp/`へ生成する。
手書きのクラス一覧を別に作らない。公開対象は`apps/launcher/src`とし、テストやLive2D SDK本体は含めない。

Doxygen warningを放置せず、公開APIの責務、引数、戻り値、エラー条件を必要な範囲で補う。

### Admin Web HTTP API

`apps/admin-web/app/api/**/route.ts`を実装上の根拠としてOpenAPI 3.1文書を作る。
想像でエンドポイントやレスポンスを追加しない。各Route、認証判定、validator、テストを読んで記述する。

最低限、次を記載する。

- HTTP methodとpath
- 認証方式と必要権限
- CSRF/Origin条件
- request body、path/query parameter
- response body
- 代表的な4xx/5xx
- upload size、part size、file countなどの上限
- idempotencyと再試行条件
- Staging/Productionで異なる権限

API定義は例えば`packages/contracts/openapi/admin-api.openapi.yaml`へ置き、CIで構文検証する。
サイトではScalar、Redoc、またはVitePress対応Rendererのうち、依存が小さく静的出力可能なものを使う。

公開してはいけない内容:

- secret名以外の実値
- GitHub App private key
- session secret
- R2 access key
- presigned URLの実例
- `.dev.vars`の内容
- 管理者の個人情報

## Phase 4: GitHub Pages CI/CD

`.github/workflows/docs-pages.yml`を作る。

要件:

- `main`または現在の既定ブランチへのpushで実行
- PRではbuildとlink checkだけ行い、デプロイしない
- Pages公式Actionsをcommit SHAでpinする
- `permissions`は原則`contents: read`。deploy jobだけ`pages: write`と`id-token: write`
- `concurrency`で同一Pagesデプロイを直列化する
- npmは`npm ci`を使用する
- VitePress build、OpenAPI validation、Doxygen生成をすべて成功条件にする
- 生成物を1つのPages artifactへまとめる
- GitHub Actions artifactへ秘密情報を含めない

GitHub PagesのProject Siteでは通常`/GameLauncher/`がbase pathになる。
リポジトリ名をハードコードせず、Actionsのrepository情報または明示設定からbaseを決める。
ローカル`/`とPages配下の両方で、CSS、画像、内部リンクが動くことを確認する。

実際のPages有効化・デプロイはユーザーが今回明示的に依頼しているため実行してよい。
ただし、リポジトリ設定や権限不足で失敗した場合は、回避策として別ホスティングを作らず状況を報告する。

## Phase 5: 検証

最低限、次を実行する。

```powershell
# Admin Web
Set-Location apps/admin-web
npm ci
npm run lint
npm test

# Docs
Set-Location ../docs
npm ci
npm run lint
npm test
npm run build

# Pythonと構成境界
Set-Location ../..
python -m unittest discover -s scripts/tests -p 'test_*.py' -v
python -m unittest discover -s services/deployment_publisher -p 'test_*.py' -v
python -m unittest discover -s packages/contracts -p 'test_*.py' -v

# Launcher
cmake --preset clion-windows
cmake --build --preset clion-windows --parallel
ctest --preset clion-windows
```

さらに次を確認する。

- GitHub Pages相当のbase pathで全主要ページをブラウザー確認
- 404になっている内部リンクがない
- モバイル幅でもナビゲーションが利用できる
- コードブロックが横方向にページ全体を壊さない
- 日本語が文字化けしない
- API referenceが静的ホスティング上で表示される
- `robots.txt`、favicon、ページタイトル、descriptionを設定
- 公開サイトから秘密情報やローカル絶対パスを検索して検出されない

可能ならリンクチェッカーと、Pages成果物に対する簡単なHTTP smoke testをCIへ追加する。

## CLionの現在の状態

このPC専用の`CMakeUserPresets.json`があり、Git管理外になっている。

- Preset: `clion-windows`
- Generator: Visual Studio 18 2026
- Instance: Visual Studio Community
- Toolset: MSVC v143 14.44
- Build directory: `build/clion-windows`

`.idea/workspace.xml`の`GameLauncher`と「すべての CTest」は`clion-windows`を参照するよう更新済み。
ローカル設定を壊さないこと。共有可能な情報は`docs/DEVELOPMENT.md`へ記録する。

## 完了条件

- npmのHigh/Critical vulnerabilityが0件、または解消不能理由が証拠付きで説明されている
- Admin Webのlint、build、テストが成功する
- DocsサイトがローカルとGitHub Pagesの両方で正常表示される
- LauncherとAdmin Webの開発・デプロイ手順が現在のパスと一致する
- C++ DoxygenとAdmin Web OpenAPI referenceへサイトから到達できる
- 旧パスを参照していない
- GitHub Pages workflowが成功する
- 公開URLを実ブラウザーで確認する
- READMEからドキュメントサイトへリンクする
- Store、Community、Platform APIの実装を開始していない

## 最終報告に含める内容

- 更新した主要npmパッケージと脆弱性の解消結果
- ドキュメントサイトの構成
- 公開されたGitHub Pages URL
- API referenceの生成方法
- 実行したテストと結果
- 残っている警告、外部設定、手動作業
