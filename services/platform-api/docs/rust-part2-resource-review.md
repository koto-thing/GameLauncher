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

ベンチマークは ローカル Windows 環境、Node 24.18.0、Rust 1.94.1、Wrangler 4.149.0、
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
その後、同じ公式ソースと四依存差分から CLI 本体を release build し、`wasm-bindgen --version` と生成処理を実行した
システムの PATH や共有 CLI は変更せず、サービスのローカル target 内だけに配置した
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

## 外部リソースの検証範囲

この公開資料はローカルの合成データによる検証だけを扱う
staging の利用状況、アカウント識別情報、運用調整手順は含めない
本番の課金 CPU と共有リソースの余裕を証明したものではなく、リリース保留を維持する

## 根拠

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers metrics and analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)
- [Workers invocation CPU / wall time](https://developers.cloudflare.com/changelog/post/2025-04-09-workers-timing/)
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [D1 pricing と index の書込](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 Free の共有 daily limit](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)


## 審査済み CLI の再現用インストーラー

Python 3.12以上、Git、Rust 1.94.1を用意し、サービス専用の次の手順を使う
共有 CI では同じ版と検証済み lockfile を利用する

```sh
python services/platform-api/scripts/prepare-reviewed-cli.py --target-dir services/platform-api/rust-validation/target/cli-reviewed
export WASM_BINDGEN="$PWD/services/platform-api/rust-validation/target/cli-reviewed/release/wasm-bindgen"
npm run check --prefix services/platform-api
```

Windows は表示された `.exe` のパスを `WASM_BINDGEN` に設定する
スクリプトは公式 archive と元 lock と修正 lock の SHA256 を確認し、四依存差分だけを適用して `--locked` でビルドする
不一致は即時停止し、既存の共有 CLI や PATH を変更しない
未保守四件と yanked 一件は build tool の generator 用途に限定して残存事項として扱う
ネットワーク test runner と server 用途は承認していない
審査済み版で Rust二件・Node/workerd三十四件・型検査・production dry-run が成功した
従来の clean-target 生成物との Wasm/JS/型定義の byte 一致も確認する
