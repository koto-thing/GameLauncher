# LT ローカル統合の再現と残件

対象は `feature/koto/LtIntegrationPart1`、通常状態・メール変更API/UI・retentionをローカル統合済み。最終検証記録は `final-local-verification.json` を参照する。元の dirty checkout と他担当 worktree を使わず、隔離した統合領域で実行する。古い経過記録は `integration-local.md`、現在の構成と実行順は本書を参照する。

## 前提と隔離

- ロックファイルに従うプロジェクトローカル依存を使う。Node／パッケージマネージャーをグローバルに変更しない。公開UIは React + Vite Plus、既存管理UIは React/Vinext のまま。
- Rust toolchain は `services/lt-api/rust-toolchain.toml`、worker-build は既存の 0.8.7 を使う。以下の `worker-build` はその既存実行ファイルへのパスに置き換える。
- 全サーバーは `127.0.0.1` に限定する。以下の Wrangler 設定はローカル専用で、本番配備には使わない。D1 コマンドは必ず `--local` を付ける。
- 通常APIのDB ID末尾は `000047`、retention専用は `000036`。いずれも架空データ専用。過去の実行済みDBは再利用せず、再現時は設定コピーで未使用のローカルDB ID・worker名と全binding先を揃える。DBを切り替えたら関連proxyも再起動する。既存DBの削除やresetを再現手順に含めない。
- 時刻固定・fake mail・削除テストを同時実行しない。CLIとHTTPが同じDBを参照することを、架空開催の状態を変更して公開HTTPでも確認してから進める。

## 起動

各コマンドは記載ディレクトリから実行する。開発サーバーはそれぞれ別ターミナルで起動する。

`services/lt-api`:

```powershell
npm.cmd ci
worker-build --release . --features local-development,runtime-tests
node node_modules/wrangler/bin/wrangler.js d1 migrations apply lt-local --local --config wrangler.toml
node node_modules/wrangler/bin/wrangler.js dev --local --config wrangler.toml --ip 127.0.0.1 --port 18877
```

同じディレクトリの別ターミナルで内部RPC接続を起動する。

```powershell
node node_modules/wrangler/bin/wrangler.js dev --local --config tests/proxy.toml --ip 127.0.0.1 --port 18878
node node_modules/wrangler/bin/wrangler.js dev --local --config tests/integration-bridge.toml --ip 127.0.0.1 --port 18879
```

上記2行も別ターミナル。18878は固定assistantのAPI試験専用で、既存管理認証を検証しない。18879は検証専用HTTPからcontextを受けnamed service bindingへ渡すbridgeであり、公開・本番設置禁止。

`apps/lt-web`:

```powershell
npm.cmd ci
node e2e/live-server.mjs
```

公開UIは `http://127.0.0.1:18880`。このfacadeは入力Originを検証してローカルAPIのOriginへ変換する試験構成で、本番proxy設定ではない。

`apps/admin-web`:

```powershell
npm.cmd ci
node tests/lt-route-browser/server.mjs
```

管理UI試験入口は `http://127.0.0.1:18920`。実route・既存認証コード・最新role/在籍確認を使うが、外部GitHub OAuthの代わりにテスト用署名cookieと架空会員DBを注入する。本番のログインや認証資格情報を作成・変更する手順ではない。通常の管理アプリ開発は `npm.cmd run dev` だが、本番 `LT_INTERNAL` bindingは未設定であり、このfixtureサーバーと同一視しない。

## 検証順と現時点の証跡

次は順番に実行し、時刻・DB・bundleを共有する試験を並列化しない。

1. `services/lt-api` で `python tests/run_runtime.py`。架空DBのmail modeをfakeへ変更し、固定時刻も使う。メール変更を含む最終ローカル統合で全58件成功。試験順序・時刻を守り、今後の変更後には再検証する。
2. `apps/admin-web` で `node --test tests/lt-binding-integration.test.mjs tests/lt-route-integration.test.mjs tests/lt-proxy.test.mjs tests/lt-operator-state.test.mjs tests/lt-timetable.test.mjs tests/operations-roles.test.mjs tests/operator-admissions.test.mjs tests/session-lifetime.test.mjs`。実proxyの401/403、失効会員・role不足、Origin、偽造header、未設定binding503、成功mutationを確認する。
3. `apps/lt-web` で `node_modules/.bin/playwright.cmd test --config playwright.live.config.ts`。初回確認→申請→実管理route承認→公開→差し戻し→編集→再承認→時間割→辞退／全体中止を確認する。テストは架空DBの募集状態を書き換えるので、API回帰と分離する。最終ローカル統合treeで通常flowとメール変更の2本が成功。
4. retentionは別DB・別ポートで実行する。下記は生成した架空データを実際に削除するテストであり、運用DBでは実行しない。

```powershell
# services/lt-api、開発＋runtime-tests bundleを使用
node node_modules/wrangler/bin/wrangler.js d1 migrations apply lt-local --local --config retention-local.toml
node node_modules/wrangler/bin/wrangler.js dev --local --config retention-local.toml --ip 127.0.0.1 --port 18897
# 別ターミナル
node node_modules/wrangler/bin/wrangler.js dev --local --config tests/retention-proxy.toml --ip 127.0.0.1 --port 18898
# 起動後、別ターミナル
python tests/retention_runtime_test.py -v
```

最終ローカル統合treeで成功。固定期限直前拒否／境界、JST3暦月・月末、38段階削除＋10段階孤立認証掃除の各失敗時rollback、正常公開保持／中止公開削除／別開催保護、未知schema停止、募集設定削除後の公開一覧・詳細のclosed維持を含む。証跡は `services/lt-api/retention/d1-verification.json`。本番削除機能の有効化を意味しない。

## 最終統合後に再実行するもの

- 共有契約: ルートで `python -m unittest discover -s contracts/lt -p test_contracts.py -v`、生成型とschema/fixtureの一致。
- 公開UI: `npm.cmd test`、`npm.cmd run check`、`node_modules/.bin/tsc.cmd --noEmit`、`npm.cmd run build`、通常Playwrightと上記live縦断、PC／390px表示。
- 管理UI: 上記LT/auth/role/在籍回帰、`node_modules/.bin/tsc.cmd --noEmit`、`npm.cmd run lint`、`npm.cmd run build`、実route経由の成功・拒否とメール変更画面。
- Rust API: `cargo check --locked --offline`、`cargo test --locked --offline --features local-development,runtime-tests`、`cargo fmt --check`、未使用DBへの全migration、全actual Worker/D1/RPC回帰。メール変更の権限・本人確認・旧token/session失効・競合を追加する。
- Mail: `services/lt-mail` の `cargo test --locked --offline`、wasm worker-runtime check、Python tests。成功／一時・恒久失敗／二重実行／lease失効・期限後拒否を維持する。
- Retention: 新メール変更schemaと削除対象を明示登録してから上記actual D1テストと参照SQLite testsを再実行。未知テーブル／ビュー／列を無視する変更はしない。
- 最後にworker-buildを通常、local-developmentのみ、runtime-tests付きの各構成で確認。前2つに `fake_mail`／`test_dispatch`／`set_clock`／`retention_test` exportやテストpauseがないことを `tests/measure_bundle.py` で確認する。build切替中はHTTP試験を実行しない。

## 本番接続前に残る事項

- 実メールは既定無効。fake outboxの成功は外部配送成功の証明ではない。ロリポップPHP中継候補はコードのみで、PHP実行・構文／無送信実行試験・実送信は未検証。アップロード、認証秘密の生成・設定、送信元設定は未実施。
- 月額追加費用ゼロが方針。Cloudflare Freeの実CPU時間・WasmとJS変換コスト・本番負荷は未測定で、無料枠内運用を実測保証していない。公開前に既存契約枠も確認する。
- 公開開始／開始・終了状態のAPI観測時reconcileは実装済み。本番cron/schedulerは未設定。無アクセス時の定期実行・監視・障害時再試行は本番接続前の作業。
- 物理削除はruntime-tests＋local-developmentの明示テストに限定し、通常buildから除外。本番scheduler／自動削除は無効。実ユーザーデータ削除の有効化は別途確認が必要。
- 本番ドメイン、同一ホストの公開API／本人cookie構成、既存管理認証と内部binding、D1配備、秘密設定は未実施。fixture cookie／固定role proxy／HTTP bridgeを配備しない。
- メール変更API・UI・契約一式と0040 schemaの保持削除処理は統合済み。今後schemaを変更した場合も厳格inventoryと削除処理を追従して上記試験を再実行する。push／PR／merge／deployは本書の作業範囲外。
