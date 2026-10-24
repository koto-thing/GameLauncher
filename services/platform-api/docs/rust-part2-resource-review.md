# Analytics Rust Part2 のリソース・依存・staging 検証

Part2 の本番リリースは保留する
ローカル wall time や OS プロセス CPU を Cloudflare の課金 CPU と同一視しない
入力制限や検証を弱めず、ホスト・プラン・権限・認証情報を変更しない

## 証拠と検証範囲

- [全 cold/warm 集計データ](evidence/analytics-workerd-metrics.json)
- [CLI のソース・lockfile checksum と互換更新](evidence/analytics-cli-resolution.json)
- [公式 CLI 0.2.129 の lockfile に対する4パッケージ更新差分](evidence/wasm-bindgen-cli-0.2.129-lock.patch)

公開する証拠には合成リクエストの集計値と公開パッケージ情報だけを含める
実データの ID、トークン、メールアドレス、認証ファイル、raw request/log は含めない

ベンチマークは STORM-PC、Node 24.18.0、Rust 1.94.1、Wrangler 4.149.0、
workerd 1.20261006.1 で実行した
Part1 は `83b0d3e`、修正前 Part2 は `2efebdd9`、転送修正後は `7597de6f` を測定した
その後の Part1 rebase と返却値ガード追加後の CPU を測定したものではない
Part1 の rebase 後の基点は `65dff2f15c9562acc916d70b9ab856b0c79fcec0`

同一の 442,675 byte の正常入力に百セッション、各九十一日配分、
六十四文字の版情報、最大 revision、三十日分の累積プレイ時間を含めた
後段エラーでは最後のセッションの最後の日別配分だけを一秒増やし、合計不一致にした
全ハンドラーは実装の `handleRequest` とローカル D1 を使い、固定時計だけを注入した
validation-only の測定は全ハンドラーの代用にはしない

各組み合わせについて新しい workerd の初回を三回測り、別の process で十回 warm-up 後に
百回の逐次リクエストを測った
正常 warm は同一 revision の再送であり、別途十件の新規 installation 書込も測った
staging と本番へのベンチマーク書込・デプロイは行っていない

## ローカル全ハンドラーの結果

| 指標 | Part1 | 修正前 Part2 | 転送修正後 Part2 |
|---|---:|---:|---:|
| 正常 warm wall 中央値 |32.88 ms|35.76 ms|32.83 ms|
| 正常 warm wall p95 |38.72 ms|42.09 ms|35.67 ms|
| 後段エラー warm wall 中央値 |10.69 ms|12.17 ms|12.04 ms|
| 後段エラー warm wall p95 |11.75 ms|18.87 ms|13.17 ms|
| 正常 cold 初回 wall 中央値 |75.93 ms|87.51 ms|80.96 ms|
| 後段エラー cold 初回 wall 中央値 |34.34 ms|42.57 ms|44.18 ms|
| 正常平均 process CPU |23.13 ms|27.81 ms|23.91 ms|
| 後段エラー平均 process CPU |7.97 ms|8.91 ms|10.31 ms|
| fresh writes warm wall 中央値 |46.41 ms|48.06 ms|50.03 ms|

wall はクライアント側の HTTP 応答消費までの時間
CPU は Windows の workerd subprocess の `TotalProcessorTime` 差分であり、
15.625 ms の粒度で全スレッドとローカル SQLite を含む
ホスト Node の CPU は含まない
cold は DB 初期化後の初回呼出しで、Cloudflare の cold start を保証する測り方ではない
起動・DB準備時間は raw 集計の `startupMs` に分離した
未参照の古い Wasm ファイルは読み込まず、同時コンパイルなしで測定した

この結果は Free の十 ms 合格を証明せず、SQLite を含む値だけから違反とも断定しない
後段エラーは正常化結果を返す前に失敗するため、返却量削減で parser のコストは解決しない
小標本・順次測定・JIT・GC・OS scheduling の変動と、本番での未計測が残る

## 入力・割当の境界

転送修正後の Wasm は 184,524 byte
計測時の JS は 96,323 byte、合計 280,847 byte
Wasm の SHA256 は `26df15f10c85c1828d5b32b1e34bf0b73f65675bfcde131723848206467378dc`
Part1 は Wasm 829 byte、JS 91,991 byte
返却値ガード追加後の JS サイズはこの歴史的測定に含めない

同一の入力で返却 JSON を 442,675 から 15,170 byte に削減した
日別配列は再転送せず、型付きの UUID・時刻だけを元のオブジェクトへ反映する
Rust はスキーマだけが扱う認証・版情報を所有フィールドへ複製しない
入力 JSON 自体は Rust に渡るため、秘密値を zeroize したという主張はしない

Wasm の初期メモリは十七 page、1,114,112 byte
観測した最大正常入力での高水位は 3 MiB から 1.875 MiB に減った
千回の追加の後段エラーの後も 1.875 MiB だった
module-level maximum は未指定であり、これは isolate 全体の heap や同時実行の上限証明ではない

入口の stream は 1,048,576 byte 以下に制限し、正規の Ajv が百セッション、各九十一日、
日別秒数・累積秒数・文字列・型を検証してから Rust を呼ぶ
Rust が処理する配分は最大9,100件、重複 ID は百件、日付集合は各九十一件
日別合計の最大 91×86,400=7,862,400 は u32 に収まる
Serde JSON の既定の再帰上限128を解除しない
元の stream chunk と結合 buffer、JS の入力 object、UTF-8 copy は一時的に重なる
許可ゲーム集合はリクエストではなくデプロイ設定に依存する

## Fail-closed の境界

スキーマと本文の拒否は Rust と D1 保存より前に行う
Rust の意味検証エラーは既存の 400 と順序を維持する
trap・不正な JSON 結果・想定外の bridge error は既存の 503 にする
欠落した session を `Object.assign` が黙って無視しないよう、正規化結果の件数・型・キーだけを
反映前に確認する
ドメインの UUID・時刻規則はホストに重複実装しない
Wasm が利用できない際の検証省略や TypeScript fallback は持たない

## CLI 依存の既知問題

Worker 自体の Cargo.lock は23 package（外部22）で、RustSec の脆弱性・警告はゼロ
直接依存は Chrono 0.4.45、Serde 1.0.229、serde_json 1.0.154、wasm-bindgen 0.2.129
外部 package の license metadata には MIT の選択肢があり、unicode-ident は追加で Unicode-3.0 を含む
CLI の依存は Worker に配信しない

wasm-bindgen CLI 0.2.129 の標準 upstream lockfile は254 package を含み、以下の七件に一致した
CVSS は RustSec の掲載値で、未掲載の項目に独自の重大度を割り当てない
影響範囲は RustSec の patched / unaffected 条件に基づく

| Advisory | Locked package | CVSS | 影響範囲 | 修正版 |
|---|---|---|---|---|
| [2026-0346](https://rustsec.org/advisories/RUSTSEC-2026-0346.html) |rustls 0.23.45|4.0 Medium|`>=0.21.0, <0.23.46`|`>=0.23.46`|
| [2026-0347](https://rustsec.org/advisories/RUSTSEC-2026-0347.html) |rustls 0.23.45|2.3 Low|`>=0.23.44, <0.23.46`|`>=0.23.46`|
| [2026-0348](https://rustsec.org/advisories/RUSTSEC-2026-0348.html) |rustls 0.23.45|3.7 Low|`>=0.23.9, <0.23.46`、rustls の Brotli feature が必要|`>=0.23.46`|
| [2026-0349](https://rustsec.org/advisories/RUSTSEC-2026-0349.html) |rustls 0.23.45|3.7 Low|`<0.23.46`、未影響範囲の明示なし|`>=0.23.46`|
| [2026-0382](https://rustsec.org/advisories/RUSTSEC-2026-0382.html) |rustls-webpki 0.103.15|未掲載|`<0.103.16` または `>=0.104.0-alpha.1, <0.104.0-alpha.8`|`>=0.103.16, <0.104.0-alpha.1` または `>=0.104.0-alpha.8`|
| [2026-0383](https://rustsec.org/advisories/RUSTSEC-2026-0383.html) |webpki-root-certs 1.0.9|未掲載|`<1.0.10`、`=0.26.11` の例外あり|`>=1.0.10`|
| [2026-0381](https://rustsec.org/advisories/RUSTSEC-2026-0381.html) |webpki-roots 1.0.9|未掲載|`<1.0.10`、`=0.26.11` の例外あり|`>=1.0.10`|

0346 は custom session store の Debug 出力、0347 は ECH と早期データの組み合わせに依存する
0348 の rustls Brotli feature は既存 CLI の feature tree に含まれない
ureq の HTTP Brotli feature と混同しない
0381/0383 の 0.26.11 wrapper 自体が除外されても、その親の1.xは別途修正版へ解決する必要がある
CLI のローカルファイル生成ではネットワーク・server 機能を呼んでいないが、
それを CLI 全体の安全性の証明として扱わない

### 同じ CLI 版を保った互換修正

crates.io の公式 0.2.129 archive を隔離コピーして調べた
archive checksum は registry index と一致した
ソースコードと CLI の版を変えず、lockfile の package 版を次の四件だけ更新した

```text
rustls             0.23.45 -> 0.23.46
rustls-webpki      0.103.15 -> 0.103.16
webpki-roots       1.0.9   -> 1.0.10
webpki-root-certs  1.0.9   -> 1.0.10
```

公開した差分は context なしの LF 形式であり、元の lock checksum を確認して `git apply --unidiff-zero` で適用する
Windows では差分と適用後の lockfile を LF に揃えて canonical checksum を確認する
この方法で公開差分から修正 lockfile の再構成も確認した
Rust 1.94.1 の `cargo check --locked --bin wasm-bindgen` は成功した
CLI 本体のリンク・インストール・実行はしていない
修正 lockfile の RustSec 脆弱性はゼロになったが、未保守四件と yanked 一件の警告は残る
未保守は buf_redux 0.8.4、multipart 0.18.0、safemem 0.3.3、twoway 0.1.8
yanked は yoke-derive 0.8.3

同じ版の互換 build は source check の範囲で実現可能
ただし元の `cargo install ... --locked` は upstream の古い lock を使うため、そのままでは解消しない
単に `--locked` を外して全推移依存を無審査で更新する方法も採らない
統合担当が公開した差分・checksum・残存警告を確認し、管理する source build に適用して
再監査・binary build・実行・Wasm/glue の再生成一致を検証する必要がある
`--no-default-features` で影響 TLS package を除外する別案も tree 上は確認したが、
代替 binary のインストールと生成結果の検証は行っていない

## 既存 staging の読み取り専用調査

2026-10-24 21:50–22:00 UTC 頃に、既存 Wrangler 認証と既存認証済みブラウザで確認した
デプロイ、合成 POST、設定変更、secret・permission・plan の変更は行っていない

| 対象 | 確認結果 |
|---|---|
| Worker |`pandd-platform-api-staging`|
| active version |`c2bbd157-bd20-4d82-8c8e-864104781e66`、100%、2026-10-15 配信|
| 環境 |`PLAY_ENVIRONMENT=staging`|
| D1 |`pandd-play-analytics-staging`、`914d4741-9a5f-4f94-b1c6-34d32dd8adf2`|
| 本番 D1 |別 ID `5c96db6e-6eef-4957-aa39-36e8581e44d8`、照会・変更なし|
| 集計 SELECT |installations / play_sessions / session_daily_durations / analytics_daily は各0件|
| 既存 revoked_credentials |1件、識別子や hash は読まず、変更しない|
| 直近24時間の Metrics |2 invocation、0 error、CPU chart P50/P99 0.94 ms|
| 保存トレース |UI に Workers Observability is Disabled と表示|
| Cron |設定は毎日18:00 UTC（03:00 JST）、保持モード active|
| 消費者 |Admin Web に `PLATFORM_API_STAGING` service binding がある|

空の詳細テーブルから利用者が存在しないとは断定しない
既存の二 invocation の種類は保存 trace がないため分類できない
現在の CPU 値は古い配信版の低トラフィックの指標であり、Part2 の検証ではない
Metrics の version / 時間範囲 / CPU quantile / exceeded-CPU 指標は新しい権限なしで読める
通常の CLI には Worker CPU metrics query command がなく、`wrangler tail` は新しい一時 session を開始するため未実行
Paid の Tail Worker は作成しない

認証ファイルのトークンを独自 API 呼出しへ再利用する方法は自動承認レビューに拒否され、未実行
その方法は再試行せず、標準 CLI と既存ブラウザ画面で調査を完了した
認証情報を公開証拠に含めない

## 承認後に行う bounded staging 検証案

ここからは未実行の手順であり、現在の許可にはデプロイと合成書込を含めない

1. 親が対象 SHA・staging Worker 名・D1 ID・元の version を記録し、他の staging 利用と重ならない窓を確保する
   直前に上の件数と active version を再確認し、実データが入っていれば valid-write phase は停止する
   本番 Worker、binding、ゲーム許可リスト、secret、permission は変更しない
2. 候補を既存 designated staging だけに配信する承認を受ける
   既存 Metrics を候補 version と短い時間窓に絞る
   個別 CPU が必要なら staging 限定の一時的 Observability 設定も別途承認する
   request body や token を custom log に出さず、CPU・wall・status・version の集計だけを保存する
   trace が取れず標本が不足する場合は Free 合格とせず保留を継続する
3. まず D1 に到達しない後段エラーだけを、逐次十リクエスト以下で送る
   現在日の九十日分を使い、最後の配分だけ一秒ずらして合計不一致400を期待する
   `environment=staging` と既存の許可ゲームを使い、新しい権限やゲーム許可を追加しない
   CPU上限、429、予期しない503、エラーメッセージ差、DB件数差が出たら停止する
4. 百×九十一の全日配分を後段まで通すには、実時計では JST 日付変更前の五分以内が必要
   例として23:56–23:58 JST の承認窓を使い、観測時刻を翌日午前零時にする
   それ以外の時刻に固定時計や未来日付の制約を変更して代用しない
5. 全正常系の測定は、空の staging、静かな利用窓、D1共有無料枠の余裕を再確認してから追加承認する
   一つのランダムな新規 installation と百個の UUID だけを使う
   事前にそれらの不在を確認し、token は公開せず cleanup 用の短期ローカル manifest に保持する
   manifest は Git 対象外とし、既存のローカル保護の範囲で扱い、権限を拡張しない
   成功した cleanup を確認するまで復旧に必要な記録を失わないようにする
   初回一回を挿入し、同 revision の再送を九回までに制限し、新規 installation の連続挿入や revision 更新を繰り返さない
6. 正常系一サイクルの一時的 footprint は installation一件、session百件、day配分最大9,100件
   集計画面に一時的な合成値が出るため、他の staging 利用が停止できない場合は行わない
   source IP の60回/分の枠を使い切らず、cleanup用の余裕も残す
7. 観測した index 数では、最大バッチの挿入と削除だけでも table/index の書込は概算約37,000行相当になる
   D1 Free の100,000行/日は account 共有であり本番にも影響しうる
   残枠を読むだけで確認し、cleanupを含め少なくとも50,000行分を確保できない場合は full-write phase を行わない
   この数は実課金メトリクスの保証ではなく、追加indexやtriggerがあれば再見積もりする
   ローカルで行った十 installation の fresh-write ループをクラウドへ持ち込まない
8. 正常系の終了時に、その新規 installation だけを自分の token で DELETE し、204と件数の復帰を確認する
   既存の revoked 一件は触らない
   cleanup後も合成 credential の失効 tombstone一件が九十日残ることを承認対象に含める
   DB file の確保済みページや観測 event は即時に消えるとは約束しない
9. JST 日付変更と保持 Cron の前に cleanup を終え、匿名履歴への変換を防ぐ
   cleanupに失敗した場合は新規送信を止め、該当 ID だけを保留事項として親へ引き継ぐ
   全件削除、時刻範囲での SQL削除、手動retention、migration適用は行わない
10. 異常時は元の staging Worker version へ rollback し、一時的に承認した観測設定も元に戻す
    Worker rollback は DB cleanup の代用にしない
    本番の merge/deploy は別の exact-SHA 判定が完了するまで保留する

承認対象は「候補の staging 配信」「必要なら staging 限定の観測設定」
「最大十件の no-write 後段エラー」「条件が成立した場合のみ一 installation の正常系と限定 cleanup」
の具体的な範囲とする
既存の実データや共有無料枠を守れない場合は、正常系のクラウド試験を実行せず保留する

## 根拠

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers metrics and analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)
- [Workers invocation CPU / wall time](https://developers.cloudflare.com/changelog/post/2025-04-09-workers-timing/)
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [D1 pricing と index の書込](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 Free の共有 daily limit](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)
