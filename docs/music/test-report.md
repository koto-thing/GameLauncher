# ローカル検証報告 — 2026-09-06

## 作業開始時

- 対象：`D:\Pandd\GameLauncher`、branch `feature/koto/AddMusicWebApp`、HEAD `bfb6d5d`。
- root `agents.md`、既存control-planeの認証Callback、Cookie、uploader、ゲームAPI、Actions OIDC、D1初期化/migration、テストを確認した。
- 既に独立Music実装と未コミットのUI・背景・テーマ・カルーセル等があり、それらを再利用した。開始時のtracked差分は`build/music-starting-changes.patch`、置換した旧接続コードは`build/music-previous`にも退避した。
- 開始前：Musicの旧構成26件成功、既存admin-webのbuild＋84件成功。今回の接続変更に伴い旧Worker/R2/OAuth試験を実control-plane＋PHP試験へ置き換えたため、旧・新の試験件数は同一の内訳ではない。
- 既存のDocsテーマ・README、別途追加されていたlauncher-download-webやrelease関連の未コミット変更は今回の実装対象にせず保持した。ランチャー本体・ゲームのrelease workflowは今回変更していない。Music用CIだけを拡張した。

## 結果

| 検証 | 実際の結果 |
|---|---|
| `apps/admin-web`: npm test | build成功、既存84件成功、失敗0 |
| admin-web TypeScript / ESLint | 成功。生成物は検査対象外 |
| `apps/music`: typecheck / lint / architecture | 成功。Domain依存方向と自作関数@briefも検査 |
| Music Node単体・統合 | **23件成功、失敗0**。実workerd/D1＋実PHPを使用 |
| E2E Chromium | **12件成功** |
| E2E Firefox | **12件成功** |
| E2E Windows WebKit | **9件成功、3件skip**。未搭載Web Audio/OfflineAudio APIを合格扱いにしていない |
| 最終管理変更後の再確認 | Chromiumで担当割当・作品背景公開と、曲登録・画像・loop・試聴・公開・取り下げの2シナリオ再成功 |
| 公開bundle検査 | 管理API/認証/Workers/GitHub/秘密設定/テストentryの混入なし、TS/PHP policy一致 |
| PHP | 第一者14ファイルsyntax check成功、固定署名ベクトル一致 |
| 配布物 | `apps/music/build/rental-package-ypy3oL`生成。static・PHP・vendor・設定テンプレート・CLI。秘密・test router・管理bundleを含めない |

既存84件はブラウザー/Origin境界、ゲーム申請・指名承認・別人承認、公開状態、Intake/uploader、manifest/descriptor、GitHub App/Actions、hash等を含む既存suite。実Production Actionsや既存データ書込みを起動した試験ではない。

## 追加した重要な検証

- Music専用Cookieでdashboard/control/Intakeを拒否、Actions機械入口はCookieで認証不可。ゲーム専用・未割当・匿名のMusic管理拒否。共通機能一覧にゲーム情報を渡さない。
- GitHub境界だけを模擬し、本人確認成功＋repository404でもMusic本人情報は成立、ゲームは閉じる。read/triage拒否、owner/write/admin/maintain許可。Callback固定、PKCE S256のchallenge/verifier照合、state改ざん・不一致、旧Cookie・期限切れ・本番originの開発Cookie拒否を確認。
- 担当解除後も同じCookieのままで次の作品・素材APIを拒否。別作品IDの曲・素材差込み、一般担当の運営設定/権限操作、悪意Originを拒否。
- 下書き・旧原本の直URL拒否、認可済みpreviewだけ成功、楽観ロック、不変upload IDの再試行、実MIME/容量/digest/長さ/画像寸法の検証。
- 実MP3、PCM WAV、JPEG、PNG、WebPを受信検証。PHP混入、形式の偽装、途中切断、同一IDの別digestを拒否。
- Rangeの通常・suffix・open end、GET/HEAD、Content-Length/Content-Range、無効range416をbyte単位で比較。
- 公開切替前障害では旧版維持、切替直後の応答消失では同じIDで再照合。D1確定だけ失敗してもreceiptから復旧し、確認待ち中に保存したdraftを維持。
- 非公開化後は元の音源・曲画像のGET/HEAD/Range/条件付き要求を拒否。current破損は503で閉じ、過去版を復活させない。
- 作品A/作品B/広告の同時反映で全scope保持。同一作品の競合は200/409。さらに**別PHPプロセス2個**を同じprivate storeへ接続し、filesystem lockで別scopeの反映保持・同scopeの競合拒否を確認。
- `verify-storage.php`で原本digest/サイズ/公開参照を検証。cleanup dry-run→applyで古い受信一時ファイルだけを回収し、新しい一時ファイル・確定素材を維持。
- 署名のkey/scope/path/environment/time/nonce/digest等と冪等性をTS→PHPの実HTTPで検証。固定ベクトルは`contracts/music/signature-vector.json`（公開テスト鍵、本番利用禁止）。

## Workers非依存・測定

実管理Use Caseで2作品6曲を公開してから、そのworkerdを停止し、管理socketへの接続失敗も確認した。以後のブラウザーでは公開PHP origin以外の通信をすべて遮断し、試行自体も記録した。新規contextでホーム→作品→曲→直URL再読込→再生→区間loop→seek→ページ移動後の再生継続を確認。

**HTTP要求23件、公開origin外への通信試行0件、ページ例外0件。** 公開サーバーからWorkersを呼ぶコードもない。テスト音源・画像は実PHPのprivate storeから現在snapshotの認可を経て配信した。公開APIの応答をモックしていない。

最終測定：desktop Chromium、390×844 viewport、CDPで遅延80ms・下り131,072B/s・上り65,536B/sを設定。ページ一連の完了HTTP転送量 **1,126,466 bytes**。loopを含む観測区間6.732秒のmain-thread TaskDuration **0.1213秒**（約1.8%相当）、JS heap used **5,536,040 bytes**。CPUはCDPタスク時間でありOS全体・Worker CPU・PHP CPU・電池消費量ではない。heapはネイティブAudioBufferを含む総プロセスメモリではない。

精密ループはChromium/Firefoxの実OfflineAudioContextでイントロ1回＋10回loop、552,000サンプルを期待波形と比較し最大誤差1e-6未満。通常のタイマーでループ位置を戻す方式は使わない。競合中の古いdecode破棄、1個のengine、PCM予算超過時の通常再生への復帰、中断後の再開も実ブラウザーで確認した。

測定音源は4秒、PCM mono 24kHzの自作トーン。48kHzで展開したPCMの理論量は1曲768,000 bytes。64MiB上限の実ファイル、10分音源、4096px最大画像、多数の同時利用者、レンタルホストの転送量上限に対する容量/CPU/RAM見積りの実測ではない。通常再生と必要時loop decodeで同じ音源を別要求することはある。次曲音源prefetchはOFF。

## ログ・再現

詳細ログはworkspace内（buildはGit管理外）：

- `build/admin-baseline.log` / `build/admin-final-tests.log`
- `apps/music/build/final-api-tests.log` / `final-types.log` / `final-lint.log`
- `apps/music/build/e2e-results.json`（33成功・3skip・flaky0） / `e2e-all.log`
- `apps/music/build/final-management.log`（最終管理2件）
- `apps/music/build/public-independence.json`（通信先・測定値） / `public-workers-stopped-390.png`
- `apps/music/build/home-*-390.png`、`game-design-*-390.png`、`theme-dark-*-390.png`、carousel画像

一括E2E初回はsandboxのWranglerユーザー開発registry書込み拒否でサーバーが停止した。必要なローカル権限を得て再実行し上記結果を確認した。管理試聴でproxy転送時のContent-Length依存、管理entryのReact重複/hydration、E2Eのlogout完了待ち等を修正して再検証した。

## 未完了・外部設定待ち・未検証

ローカルの登録→自主公開→画像付き聴取→区間loop→取り下げ→障害再試行は実装・検証済み。

**外部設定待ち**：本番GitHub Appの固定Callback URL、Music運営の実GitHub ID登録、既存D1への追加migration、WorkerのMusic専用鍵/接続先、レンタルサーバーPHP/拡張/私有領域/Apache設定、HTTPS/DNS。特にGITHUB_CALLBACK_URLは共通認証の本番更新より先に設定が必要。

**未検証**：実GitHub App OAuthと既存Device Flowの実サービス往復、本番D1/レンタルホストへの転送、実Apache rewrite/headers/subdirectory配置、ホスト固有のflock/rename/ディスク障害、本番backup/restore訓練、実iPhone Safari・Android Chromeでの音声・バックグラウンド・画面ロック・OS割込み・省電力・Bluetooth/ヘッドホン、最大素材・多数同時聴取の負荷。viewportエミュレーションを実機合格としない。

**今回は実施しない**：本番公開、DNS変更、有料契約、既存データ削除、実公開Actions起動、投げ銭/動画/ランチャー本体機能。無料枠内運用や配信費用の保証はしていない。

設定と起動、運用・復旧・切戻しは[operations.md](operations.md)参照。
