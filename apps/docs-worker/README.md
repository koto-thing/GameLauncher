# Docs Web Editor

公開記事はVitePress・Redoc・Doxygenの静的ファイルです。Git管理された `docs/` が唯一の原本で、D1に本文を保管しません。閲覧・ローカル検索はログイン不要です。編集UIは `/editor` を開いたときだけ読み込まれます。

**本番未導入です。** GitHub App、Docs専用D1、Secrets、公開先は所有者の設定待ちです。実AppのOAuth、別Collaboratorによる実commit/PR/merge、Actionsイベントの起動、Cloudflareへの実配信、Cloudflare CPU時間は未確認です。テスト用サーバーの成功は本番成功を意味しません。

## 閲覧・編集・公開

固定対象は `koto-thing/GameLauncher` / repository ID `1152962221` / base `master` です。ログイン時とAPI利用時にGitHub App user access tokenでユーザーID・リポジトリID・push能力・Collaboratorの実効write/maintain/admin権限を確認します。招待未承諾、read/triage、権限剥奪、App対象外、token失効時は停止します。権限剥奪は次の認可で反映されます。進行中のGitHub操作もGitHub自身の権限判定を受けます。

公開記事の「このページを編集」から同じ記事へ戻れます。通常原稿はMarkdown、ホームは見出し・説明・導線のフォーム、ナビゲーションは名前・順序・階層・内部リンクのフォームで編集します。画像アップロードはなく、既存 `/images/pandd-logo.png` の参照のみ許可します。

保存は `docs-edit/<numeric-user-id>/<uuid>` へのcommitとPR作成・更新です。**公開リポジトリのブランチ・PRは公開されています。秘密情報を書かないでください。** 端末の復旧用下書きはGitHubへの保存ではなく、同じ端末・ブラウザー・GitHubユーザー用です。ログアウト時に保持・削除を選択できます。

保存後はGitHubから本文を再取得して照合します。公開は別操作です。最新head/baseの `docs-cloudflare.yml` 検証成功、PR全ファイルの構文・mode・対象検査、再認可後、本人tokenでexpected head SHA付きsquash mergeを行います。master反映後も配信待ちであり、現在配信している `version.json` のcommitがmerge SHAを含むと確認できるまで「公開済み」にしません。15秒間隔・最大20回の確認と手動更新を用意しています。

## 保存の競合・再試行

- 元blob SHAとheadが古ければ409を返し、元の文章・自分の文章・最新の文章を比較します。自動上書きやforce pushはしません。
- masterが先に更新された場合は、画面で最新版を比較元にし、差分を調整して**新しい変更**として保存・再検証します。旧PRは自動マージしません。不要な旧PRのクローズはGitHubの通常操作で行います。
- 新規ページは `guide/<英小文字・数字・ハイフン>` に限定し、既存のURL・大小文字違い・index衝突を拒否します。本文と目次の登録を一つのGit tree/commitで保存します。
- 保存中は入力を止め、同じ冪等性キーで再試行します。D1で操作digest・生成commitを保持し、ref・PRが実際に作成されたか照合します。異なる本文で同じキーは利用できません。
- GitHubとD1は分散トランザクションではありません。commitオブジェクト作成直後に障害が発生すると、refから参照されないcommitが残る可能性があります。ref更新は非force、同じ親から分岐した競合commitは拒否されます。3分の操作ロックが失効するまでは再操作を停止します。
- 30日を超えた操作は再開対象外です。GitHubのPRと原稿を確認して新しい変更を開始してください。監査保持期間の終了やD1全損後も、過去キーを再利用してはいけません。

## セキュリティ境界

AppのContents権限はリポジトリ全体の権限です。`docs/` フォルダー制限はGitHubの権限境界ではなく、このWorkerのallowlistです。既存Admin WebのApp、Cookie、DB、R2、署名鍵、Production承認APIは使用しません。PAT・private key・installation tokenも不要です。

`apps/docs/editor-manifest.json` が既存の手書き原稿とURLの対応を定義します。新規ページは構文・目次登録を検証したguide直下のみです。任意ref、`.github`、`apps`、`.vitepress`、実行コード、削除・rename、symlink/submodule/実行file modeは編集対象外です。生成API資料に共通の戻りリンクと編集不可表示を付けています。過去の計画書・引継ぎ資料をナビゲーションや検索へ自動登録しません。ただしGitHubや既存の静的URLで閲覧できる資料を非公開にする仕組みではありません。

保存とビルドの両方が `apps/docs/editor-policy.mjs` を使います。raw HTML、Vue式・コンポーネント、script/style、include/import、未知frontmatter、危険schemeを拒否し、コードフェンス・inline code内のサンプルは維持します。通常記事frontmatterはtitle/description、ホームはそれにmanual構造だけを許可します。未知の項目は削除せず編集不可を表示します。ホームの旧hero/featuresは今回のコード差分でmanualへ変換し、旧導線が残ることをテストしています。旧形式を解釈する互換層はありません。

プレビューはMarkdown-it、DOMPurify、権限を与えないsandbox iframeを使用し、Vue compileを行いません。静的配信は `_headers` のCSP・frame-ancestors・nosniff・Referrer-Policy、認証APIはno-storeと専用CSPを設定します。Doxygenの実行可能なinline scriptは再現可能な後処理で外部JSへ抽出し、非実行のJSON設定を保持します。

OAuth stateは10分・一回のみ、ブラウザーのHttpOnly CookieとD1試行レコードを結び、PKCE S256を使用します。固定originのcallbackと固定repository_idで交換します。本番Cookieは `__Host-pandd_docs_session`、HttpOnly/Secure/SameSite=Lax/Path=/・Domainなしです。D1はCookieのハッシュ、数値user ID、期限、CSRF、AES-256-GCMで暗号化したtokenのみを保持します。nonceは毎回ランダムで、暗号の追加認証データにセッションとユーザーIDを結びます。セッションはtoken期限以内・最大8時間、refresh tokenは保存しません。

変更APIはJSON・同一Origin・セッション固有CSRFを要求します。変更と公開はGETでは動きません。監査は数値ユーザーID、操作ID、時刻、操作、commitのみ、90日保持です。操作状態は30日、OAuth/セッションは期限で無効です。毎時のcronが各表最大200行ずつ期限切れを削除します。生token、原稿、OAuth queryはログに記録せず、Wranglerのinvocation logsも無効にします。追加のアカウントログ・Logpush等でもcallback queryを保存しない設定にしてください。

## 所有者による導入手順

1. このコードをレビューし通常のPRでmasterへ入れ、既存GitHub Pagesを残したまま検証します。本番の切替やDNS変更は、この実装作業では行っていません。
2. Cloudflareの契約と他Workerを含むアカウント使用量を確認します。別の検証環境は別Worker・別D1・別GitHub Appにしてください。`docs.koto-thing.com` は候補であり、使用可能なDNS名だとは仮定しません。
3. GitHub Settings → Developer settings → GitHub Apps → New GitHub AppでDocs専用Appを登録します。Public / Any account、Marketplace掲載不要、ユーザー認可のCallback URLは `https://<検証用の正規ホスト>/api/docs/auth/callback`、ユーザーtokenの有効期限を有効にします。Webhookの受信は初期版では利用しません。
4. Repository permissionsを **Metadata Read、Contents Read & write、Pull requests Read & write、Actions Read** にします。Actions/Workflows write、Administration、Secrets、Membersは付与しません。
5. 所有者がAppを `Only select repositories → GameLauncher` にインストールします。他のCollaboratorはAppをインストールせず、サイトで各自OAuth認可します。Client IDをGitHub Repository Variable `DOCS_GITHUB_CLIENT_ID` に設定します。
6. CloudflareでDocs専用D1を作成します。`apps/docs-worker` で `npx wrangler d1 create pandd-docs`。出力されたIDを `wrangler.jsonc` のdatabase_idとGitHub Variable `DOCS_D1_ID` に設定し、`npx wrangler d1 migrations apply DOCS_DB --remote` を実行します。既存Admin WebのD1を指定しないでください。
7. `wrangler.jsonc` の `DOCS_ORIGIN` を検証用HTTPS origin（末尾スラッシュ・パスなし）に、Client IDを登録します。初回の**所有者承認済み**デプロイは編集無効のまま行い、公開URLに静的サイトを準備します。これによりCIの配信順序確認先も確定します。Custom Domain追加はまだ不要で、workers.devを使えます。
8. Client Secretは `npx wrangler secret put GITHUB_CLIENT_SECRET` に入力します。`DOCS_TOKEN_KEY` は暗号学的乱数32バイトをbase64化し `npx wrangler secret put DOCS_TOKEN_KEY` に登録します。例：`node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"` の出力を自分の端末だけで扱います。**秘密値をチャット、原稿、VITE_変数、GitHub Variableへ貼り付けないでください。**
9. masterの既存Protect master rulesetを維持し、`Docs validation` を必須status check、**Require branches to be up to date before merging（strict）** を有効にします。GitHub Actionsを期待するsourceに選びます。PR必須・直線的履歴・スレッド解決・bypassなしを維持します。追加レビュー人数は0のままで構いません。APIのexpected SHAはheadだけを固定するため、baseの最終競合はこのGitHub側の強制が必要です。Workerは設定を読み取り、未設定なら公開を止めます。追加のAPI権限はMetadata Readだけです。
10. GitHub Environment `docs-production` を作り、対象ブランチをmasterに制限します。Secretsに `DOCS_CLOUDFLARE_API_TOKEN` と `DOCS_CLOUDFLARE_ACCOUNT_ID` を設定します。TokenはDocs運用専用、対象CloudflareアカウントのWorkers Scripts Edit等、実際のデプロイに必要な最小スコープとし、DNS変更権限・R2権限をCIに付けません。Cloudflare tokenのリソース指定がアカウント単位の場合、単一Workerに閉じない限界があります。
11. Repository Variablesの `DOCS_ORIGIN`、`DOCS_D1_ID`、`DOCS_GITHUB_CLIENT_ID` を確認します。`DOCS_CLOUDFLARE_ENABLED=true` が配信有効化スイッチ、`DOCS_EDITING_ENABLED=true` が編集有効化スイッチです。最大入力時のFree CPU時間・下記受け入れ確認が済むまで編集はfalseで維持します。資格情報が存在するだけで自動有効化しません。
12. docs-cloudflare workflowを信頼したmasterで実行し、別Collaboratorで下記実機確認を行います。buildジョブに本番Secretはなく、deployジョブは検証済みWorker bundleと静的成果物を `--no-bundle` で配信します。npm lifecycleや原稿ビルドをSecret付きで実行しません。過去公開版が対象commitより新しければデプロイしません。

## ローカル実行

Node.js 22.13以上（検証端末では24.18）とnpm、CMake、Doxygen 1.18.0を使用します。VitePressは2.0.0-alpha.19を維持します。

```sh
cd apps/docs
npm ci
npm run lint
npm test
npm run build
cd ../..
cmake -S . -B build/docs-api -DPANDD_DOCS_ONLY=ON
cmake --build build/docs-api --target docs-check
# build/docs-api/docs/doxygen/html の内容を apps/docs/dist/reference/cpp にコピー
node apps/docs/scripts/finalize-site.mjs
node apps/docs/scripts/check-built-site.mjs
cd apps/docs-worker
npm ci
npm test
npm run db:local
npm run check
npm run dev
```

閲覧は `http://localhost:8787`。Secrets未設定時にログインは「管理者による設定待ち」と表示します。開発Appだけのcallbackは `http://localhost:8787/api/docs/auth/callback`。本番Appへlocalhostを追加しません。開発Secretは `.dev.vars.example` を参考にGit管理外の `.dev.vars` に置きます。本番用・検証用callbackはそれぞれの正規HTTPS originで `/api/docs/auth/callback` を使用します。

`node test-support/browser-server.mjs` は127.0.0.1:8790だけで動く**明示的な隔離UIテスト**です。画面にLOCAL TESTを表示し、GitHubをモックに置換します。実App/実配信の検証には使用できません。本番Workerからこのファイルをimportする経路やデモログイン設定はありません。

Wrangler 4.127.0付属workerdが受け付けるcompatibility dateは2026-09-02までだったため、その日付へ固定しています。Windowsの制限された端末ではWranglerのログ/設定先をプロジェクトの `build/` 内へ指定して実行できます。例：PowerShellで `$env:XDG_CONFIG_HOME` と `$env:WRANGLER_LOG_PATH` をその配下へ設定します。

## 無料枠と入力上限

2026-09-05に確認した公式資料では、Workerコードを実行しないStatic Assetsは無料・無制限。Workers Freeは動的100,000 requests/day、CPU 10ms/request、D1 Freeは5,000,000 rows read/day、100,000 rows written/day、総ストレージ5GBです。無料枠は既存Admin Web等と共有されます。既存Paid契約がFreeへ変わるわけではありません。

この実装の上限は原稿16KiB、1変更3ファイル、HTTP本文210KB、GitHub応答4MB、1ユーザー未完了10変更、変更10回/分、認証済み操作60回/分、OAuth開始10回/分/IPです。Markdownは600行・開き角括弧512個までです。既存の最大編集原稿は10,260 bytesでした。目次は120項目・3階層以内、frontmatterは8,192文字以内です。GitHub処理は60秒timeout、完全なtree/PR差分を取得できなければ停止します。

`node scripts/benchmark.mjs` でNode上の参考CPU値を再測定できます。これはFree Workerの課金CPU計測ではありません。初期64KiBの角括弧連続入力はNode CPU p95約93msだったため16KiBと構文量制限へ変更しました。変更後の検証関数の100回平均はこのWindows端末で概ね0〜0.2ms/回ですが、Windows CPU計測粒度やJITの影響があります。GitHub/暗号/SQLを含む全APIの本番最大CPUは**未測定**です。Freeに必ず収まるとの保証はしていません。検証用Workerで最大の取得・新規2ファイル・更新3ファイル・公開・状態確認・OAuthを計測し、超えるなら入力や処理を削減します。安全検査を削除したり、承認なくPaidへ移行しません。

静的成果物は最大20,000ファイル・各25MiBを検査し、Worker bundleもWranglerで確認します。通常の閲覧は `run_worker_first: ["/api/docs/*"]` の対象外で、D1/GitHub接続は不要です。未知の静的URLは404、未知のAPIも404 JSONです。D1やGitHubが障害でも編集は安全なエラーで停止し、既存静的版を保持する設計ですが、Cloudflareアカウント全体の障害時まで閲覧継続を保証しません。

## 移行・停止・復旧

検証URLで記事・検索・Redoc・Doxygenの深いリンクと新規ページを確認し、所有者の承認後にCustom Domainを追加します。Cloudflareの有効なDNS zoneで対象サブドメインだけを設定し、本番App callbackとDOCS_ORIGINをそのoriginに揃えます。ムームードメインの登録移転は不要です。既存ロリポップのサイト・メール・MX/TXT/A/CNAME・downloads系DNSを変更しません。

GitHub Pagesは本番確認まで残します。旧 `/GameLauncher/` と新 `/` を別ビルドし、canonical・sitemap・画像・検索・生成API資料を検証します。旧Pagesの静的リダイレクトはサーバー301ではありません。切替後、対応する深いリンクの案内・canonical・必要ならmeta refreshを別の承認済み変更で用意します。DNS名が未確定なので、今のコードに未確定URLへのリダイレクトは入れていません。ロールバック期間終了後に旧workflowを整理します。

- 緊急停止：`DOCS_EDITING_ENABLED=false` を設定したWorkerをデプロイし、必要ならAppの対象インストール・認可を削除します。静的原稿は残ります。
- Token失効/App削除：次のGitHub認可で停止します。復旧後に再ログインします。installation token/PATへ切り替えて突破しません。
- 暗号鍵ローテーション：編集を停止、旧セッションを失効（Docs専用D1のsessions/oauth_attemptsを削除）、新しい32バイト鍵をSecretへ登録、編集を再開し全員再ログインします。旧鍵を並行保持する互換経路はありません。
- D1障害：編集停止のままD1を復旧します。バックアップを戻す場合、GitHub側のbranch/PR/headを照合してから再開し、古い操作を機械的に再実行しません。GitHub原稿をD1から復元する必要はありません。
- 配信失敗：masterへのmergeと一般公開を区別して表示します。失敗ログを直し、同じ信頼済みcommitの配信を再実行します。既存正常版の成果物は上書きしません。誤った版を配信した場合は所有者がCloudflareの正常なversionへrollbackし、再配信・旧Pagesへの戻しを判断します。
- GitHubのPRや編集ブランチは自動削除しません。30日で期限切れになった未完了変更は、所有者がPRを確認して通常のGitHub操作で整理します。

## 本番の受け入れ確認（所有者）

未認証閲覧、検索、API深いリンク、GitHub Appの実ログインと同じ記事への復帰、別アカウントのwrite Collaboratorによる既存記事・新規記事+目次・ホーム・目次の保存/再取得/公開を確認してください。Appのuser tokenによるcommit/PR/mergeでActionsが起動すること、最新baseに対する必須検証、スレッド未解決/承認要求の停止、失効・権限剥奪、二人の同時編集、D1/上流障害、無料枠相当制限、配信失敗・後続commitの包含確認を行います。

実OSの日本語IME、スクリーンリーダー、実スマートフォン、200%拡大も最終確認対象です。モックは同時実行・応答切断・CSRF・state・mode・危険構文等を再現しますが、GitHub/Cloudflareの実アカウント検証を代替しません。

公式資料：[GitHub App user token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[branch rules API](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch)、[Static Assets routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)、[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)、[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)、[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。
