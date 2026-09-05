# Docs Web Editor 実装・検証記録

2026-09-05。対象は `koto-thing/GameLauncher`、作業開始時HEADは `276b7639f20755ab33c3bff989bfcc53738c3dac` です。

**コードとローカル検証まで実施しました。本番接続を含む完成判定はしていません。** 実際のGitHubログイン・commit・PR・merge・Cloudflare配信は未実行です。

## 現在のトップレイアウト

追加の要望により、トップは左サイドバー・見出し・説明・縦並びの番号付き目次という元のレイアウトに戻しました。大きなヒーロー・フロッピー・帯・2列カードは削除しています。

配色はさらにPandDロゴを基準に刷新しました。ロゴ画像の主要色は `#FF6777`（コーラルピンク）、`#3A3A3A`（チャコール）、白です。背景は黄みのないグレーと白、アクセントはピンクに統一しています。明色では文字用に `#B52F48`、暗色ではリンク用に `#FF8290` を使い、読みやすさを確保します。レイアウトとピクセル欧文は維持し、検索・編集画面・プレビュー・生成APIのヘッダーにも反映しました。

ビルドと866生成ファイルのリンク検査が成功し、明暗のブラウザー表示を確認しています。最新画面は [暗色](../../build/docs-review/pandd-colors-dark.png)、[明色](../../build/docs-review/pandd-colors-light.png) です。以下のオレンジ配色の記録は変更履歴です。

## 参考サイトに合わせたデザイン修正（変更履歴）

追加で指定された [2P GAME ARCADE](https://2pgarcade.com/contest-144mb.html) に合わせ、黒に近い背景・クリーム・オレンジ・ピクセル欧文へ変更しました。トップに大きな文字とCSSによるフロッピー、番号付き2列の目次を配置しています。フロッピーは目次へのリンクです。記事・検索・編集画面も配色を統一し、日本語本文は通常の読みやすい書体を保ちます。

Press Start 2PをGoogle Fonts公式リポジトリから取得し、SIL OFL 1.1のライセンスとともにローカル配信します。新しい訪問者には暗色モードを初期表示し、既に選択済みの明暗設定は尊重します。

この修正ではDocsテスト33件とソース検査が成功し、`/`・`/GameLauncher/` の生成APIを含むビルド/リンク検査が成功しました。最新成果物は866ファイル、ルート版10,203,946 bytesです。デスクトップ・390px幅・明暗モード・目次移動・検索・設定待ち表示をブラウザーで確認しています。最新の画面は [トップ](../../build/docs-review/arcade-home.png)、[モバイル](../../build/docs-review/arcade-mobile.png) です。以下の初回実装時の記録・画像と区別してください。

## 実装した内容

- VitePressを維持し、白い紙面・紺・赤・グレーのマニュアル風テーマ、番号付きのホーム導線、明暗モード、閲覧/編集状態と公開版表示を追加。
- 通常記事のMarkdown、ホームの見出し/説明/導線、目次の表示名/階層/順序を編集。新規記事はguide直下に作り、目次と同じcommitで保存。
- 編集画面の遅延ロード、安全なプレビュー、原文差分、新規ページに伴う目次差分、端末下書きと復旧、競合比較、保存と公開の別操作。
- Docs専用Worker/D1、GitHub App user token、PKCE/state、暗号化セッション、CSRF、Collaborator実効権限とrepository IDの検査。
- allowlist、通常file mode、構文/サイズ制限、非force ref更新、保存結果の再取得、操作キーによる再試行、PR検証とexpected SHA付きsquash merge。
- Static Assets、静的CSP、version.jsonによる配信確認、検証とSecretを分離したCI/CD。RedocとDoxygenの生成資料を保持。
- D1 migration、環境変数例、導入・上限・停止・復旧・段階的ドメイン移行手順。

既存のGitHub Pages workflowは継続します。実作業前からあったAdmin Webの `globals.css` と `IntakeUploader.tsx` の変更には手を加えていません。

## 実行した検証

| 対象 | 結果・範囲 |
| --- | --- |
| Docsテスト | 33件成功。安全なMarkdown、日本語/改行/コード/表/frontmatter、パス制限、ホーム導線維持等 |
| Workerテスト | 34件成功。うち1件は実workerd/Miniflare D1によるmigration・SQL・保存再試行。他はSQLite D1アダプターとモックGitHub |
| lint / OpenAPI | 成功。OpenAPIに既存の警告13件あり、エラーなし |
| VitePress / Redoc / Doxygen | `/` と `/GameLauncher/` でビルド・生成リンク検査成功。CMakeのdocs-checkも成功 |
| 配信artifact | 863生成ファイル、ルート版9,943,852 bytes。最終Worker dry runは約501.02 KiB、gzip 123.53 KiB |
| 配信bundleの再利用 | `--no-bundle --dry-run` 成功。静的HTML等がWorkerの追加moduleへ混入しない設定を確認 |
| 依存監査 | Docs / Workerともnpm auditで既知の脆弱性0件（確認時点） |
| 公開側ブラウザー | ローカルWranglerでホーム・記事・明暗表示・390px幅・検索・Redoc/Doxygen深いリンク・Doxygen検索・設定待ち編集画面を確認 |
| 編集側ブラウザー | 外部通信を遮断したLOCAL TEST環境で既存記事、ホーム、目次の名前/並び順、新規本文+目次の保存と原稿一致を確認。プレビュー、差分、復旧待ち再読込、モック公開状態も確認 |
| セキュリティ・障害 | 権限不足/剥奪、ユーザー/リポジトリ不一致、Cookie/state/CSRF、D1障害、危険構文/file mode、古いhead/base、CI失敗、保存連打、ref/PR/merge応答切断、配信失敗等をローカルテスト |

Node 24.18.0、Wrangler 4.127.0、Doxygen 1.18.0を使用しました。CI定義はNode 22.13.0です。CIのLinux実行そのものは未実行です。Launcher全体のビルド/CTestやAdmin Web全体のテストはこのDocs変更では再実行していません。

画面記録は作業フォルダーの [比較ページ](../../build/docs-review/index.html)、[変更前](../../build/docs-review/before.png)、[変更後](../../build/docs-review/after-light.png)、[暗色](../../build/docs-review/after-dark.png)、[モバイル幅](../../build/docs-review/mobile.png)、[編集の検証画面](../../build/docs-review/editor.png) にあります。編集画面のLOCAL TEST表示は本番に含まれません。

## 制限と未実行項目

- 原稿16KiB、600行、開き角括弧512個、1変更3ファイル、未完了10変更/ユーザー。既存最大原稿は10,260 bytesでした。
- Node上では、初期64KiBの角括弧連続入力がCPU p95約93msに達したため、入力上限と構文量を削減しました。変更後の検証関数の100回平均は概ね0〜0.2msですが、計測粒度・JITの影響を受ける参考値です。
- **Cloudflare Free CPU 10msに全APIが収まるかは未測定です。** 本番でのStatic AssetsのWorker非起動、D1行数/共有無料枠、実トラフィックも未測定です。コードのルーティング設定・ローカルのD1非依存検査と、本番の使用量検証を区別します。
- 実App OAuth/PKCE、別Collaborator、権限変更直後、二人の実同時編集、user tokenによるActions起動、実CI/merge/deploy、障害復旧、後続commitの実配信包含確認は所有者の検証環境で行う必要があります。
- 実OSの日本語IME、スクリーンリーダー、実スマートフォン、ブラウザー200%拡大は未実行です。日本語文字列のテストや390px viewport確認で代替したことにはしません。

## 所有者の設定待ち・切替後の作業

GitHub App登録/インストール、Docs専用D1、Client ID、Secret/暗号鍵、検証用HTTPS origin、CI配信資格情報を設定してください。masterの保護は維持し、`Docs validation` の必須チェックと最新base必須を追加します。未設定時は公開操作を停止します。

入力上限でのCPU計測と実アカウントの受け入れ確認後に編集を有効化します。Custom Domain、DNS、本番への切替は未実施です。旧Pagesからの案内/深いリンクのリダイレクト、旧workflowの整理は、本番URL確定・所有者承認・ロールバック期間の終了後に行う残作業です。

具体的な順序、コマンド、Secret登録先と復旧方法は [導入README](README.md) を参照してください。秘密値をチャットや原稿に貼る必要はありません。
