# Platform API

ゲームランチャーが利用者の同意後に送信するプレイセッションを受け付け、管理者へ
ゲーム別の集計を返すCloudflare Worker。統計専用D1を使い、Admin Webの申請・承認DBと
分離する。現在のデプロイ単位には統計機能だけを実装している。

## API

| メソッド・パス | 用途・認証 |
| --- | --- |
| `POST /v1/play-sessions` | 同意済みセッションの累積スナップショット、インストールごとの私有トークン |
| `DELETE /v1/installations/{installationId}` | 保存済みの識別可能な記録を削除、同じ私有トークンをBearerで指定 |
| `GET /v1/analytics/games` | 集計取得、サーバー専用の`ANALYTICS_READ_TOKEN`をBearerで指定 |

送信契約は[play-sessions.schema.json](../../packages/contracts/schemas/play-sessions.schema.json)、
集計結果の型は[src/types.ts](src/types.ts)。インストールIDはランダムUUID、私有トークンは
暗号学的乱数32バイトを小文字64桁のhexとして生成する。ハードウェアIDは扱わない。
トークンはAPIでIDと組み合わせてSHA-256へ変換し、そのダイジェストだけを保存する。
最初の送信で登録し、別のトークンによる同じIDの利用を拒否する。

POSTはJSON、1 MiB以下、1〜100セッション。`ALLOWED_GAME_IDS`に登録したゲームと
デプロイの`PLAY_ENVIRONMENT`だけを受け付ける。日時はUTCのISO 8601、日別時間は日本時間。
開始日が保持範囲外、未来5分超、経過時間を超える実行時間、日別時間の合計不一致などは
バッチ全体を400として拒否する。実行時間の上限は1セッション30日。

セッションIDとrevisionで再送を識別し、古いrevisionと同じrevisionは上書きしない。
所有インストール・ゲーム・バージョン・開始日時の変更、累積時間の減少、終了済み
セッションの結果の書き換えは409。同じバッチはD1のトランザクションで処理する。
レスポンスは`{accepted:[{sessionId,revision}]}`で、古い再送でもその送信revisionを返す。
400・409・413は内容の修正が必要、401は私有トークン失効、429と503は待機して再送する。
ゲームの起動や実行を送信完了まで待たせない。

GETのパラメーターは`from`、`to`（日本時間の日付、両端を含め366日以下）、
`environment`、任意の`gameId`・`gameVersion`。環境の指定は接続先Workerと一致させる。
Admin WebはProductionとStagingのService Bindingを使い分ける。読み取り用トークンを
ブラウザーやランチャーへ渡さず、インストールIDも集計レスポンスへ含めない。

## 集計の定義

- 起動回数・終了結果・平均・中央値・時間分布は期間内に開始したセッションが対象
- 平均・中央値・時間分布は起動失敗を除き、実行中と計測中断は確認できた時間までを含む
- 合計実行時間は日別の確認済み時間を合算し、日付をまたぐ場合は各日に配分
- 利用端末数は成功した起動、または正の確認済み実行時間がある日を利用日とする
- 再訪率は保持中の90日間で確認できた最初の成功起動日を起点とする、実際の初回プレイとは限らない
- D1・D7はその翌日・7日後の利用を数え、まだ終了していない日本時間の当日は分母に含めない
- 最終観測から10分を超えた実行中セッションは集計上の計測中断として表示する
- 計測中断判定はプロセスのクラッシュを意味せず、オフラインの利用も含み、後続の送信で訂正される
- ヒストグラムの`minSeconds`は含み、`maxSeconds`は含まない、nullは上限なし
- 人数は収集しない、ランダムIDの再生成・再インストールは別端末として数える

## 保持・削除

詳細は現在の日本時間の日付と、その前89日間を保持する。毎日日本時間03:00のCronで
古い詳細を識別子を持たない日別集計へ変換してから削除する。変換・削除は同じ
トランザクションなので、再実行や集計取得と競合しても二重計上しない。90日間受信がなく、
詳細セッションも残っていないインストールの認証ダイジェストとIDも削除する。

削除APIはセッション・日別詳細・インストール認証を削除する。識別子を持たない過去の
日別集計は残る。遅れて届くリクエストによる復活を防ぐため、IDと私有トークンの組を
ハッシュ化した失効ダイジェストだけを90日保持する。削除は繰り返しても204を返す。

過去の匿名集計と現行の詳細は同じ読み取りトランザクションで集計する。
詳細の保持範囲外を含む期間や、詳細を削除したセッションの日跨ぎ時間が含まれる場合は
`detailAvailable:false`とし、端末数・中央値・再訪率をnullで返す。

## セットアップ

Node.js 24以上を使用する。Ajvはビルド時に静的バリデーターを生成し、Workersで禁止される
動的コード生成を実行時に使わない。

```powershell
cd services/platform-api
npm ci
npx wrangler d1 create pandd-play-analytics-staging
npx wrangler d1 create pandd-play-analytics
```

返されたdatabase_idを`wrangler.jsonc`の各環境へ設定し、各環境の`ALLOWED_GAME_IDS`へ
カンマ区切りの配信対象ゲームIDを設定する。空の許可リストは全ゲームを拒否する。

```powershell
npx wrangler secret put ANALYTICS_READ_TOKEN --env ""
npx wrangler secret put ANALYTICS_READ_TOKEN --env production
npx wrangler d1 migrations apply ANALYTICS_DB --remote --env ""
npx wrangler d1 migrations apply ANALYTICS_DB --remote --env production
npx wrangler deploy --env ""
npx wrangler deploy --env production
```

読み取り用トークンは十分な暗号学的乱数を含む32文字以上にする。
Admin Webの`ANALYTICS_READ_TOKEN`と`ANALYTICS_READ_TOKEN_STAGING`に対応する値を設定し、
`PLATFORM_API`を`pandd-platform-api`、`PLATFORM_API_STAGING`を
`pandd-platform-api-staging`に接続する。レート制限Bindingは必須で、未設定時は送信を拒否する。
Cloudflareのレート制限は分散した概算制限であり、厳密な全世界共通カウンターではない。
一般公開クライアントの自己申告値なので、報酬やランキングの証明には使用しない。

ローカルでは`.dev.vars.example`を`.dev.vars`へコピーしてランダムな読み取りトークンを
設定し、`npm run db:local`後に`npm run dev`を使う。Productionの秘密情報をコピーしない。

## 検証

```powershell
npm run check
```

型検査、実SQLiteでの順序違い・重複・同時登録・所有権競合・日跨ぎ・保持期限・再訪率・
削除・計測中断の検証、実workerdとD1での送信から集計・削除までの検証、両環境の
バンドル検証を行う。自動テストとdry-runは本番デプロイやリモートDB更新を行わない。

参照: [D1のJSONクエリー](https://developers.cloudflare.com/d1/sql-api/query-json/)、
[D1バッチ](https://developers.cloudflare.com/d1/worker-api/d1-database/)、
[Workersレート制限](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
