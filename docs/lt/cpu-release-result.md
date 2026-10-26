# 単一release最適化候補の結果

2026-10-25 14:51 UTC。公開CPU gateは未達。追加費用・契約変更は行っていない。

- ソース: `9bc71ab57b4cd453f6a0c369f57962f4dc588df0`
- 専用API version: `344cd98d-51c7-43ca-8998-926ebbaf98fe`
- release設定: `opt-level="s"`, `lto=true`, `codegen-units=1`, `strip="debuginfo"` の一候補だけを比較。
- production upload: 1,395.15KiB → 987.11KiB、gzip 446.03KiB → 357.44KiB。サイズ減少をCPU改善と同一視しない。

| 経路 | CPU ms（要求順） | wall ms |
| --- | --- | --- |
| 公開一覧200 | **29, 16, 2** | 236, 157, 148 |
| 無効session501 | 1, 1, 0 | 1, 1, 1 |
| 運営HTTP404 | 1, 0, 0 | 1, 0, 1 |

同じ空の専用D1、同じ経路・回数・間隔の逐次要求を使用し、手動warmupはしていない。全9件を合成ID、sequence、version、route/statusで一致させた。公開一覧の初回2件は別のmodule marker・要求番号1だった。3件目は1件目と同じmarker・要求番号2・Wasm module load数1で、CPU 2msだった。

## 初期化とcounterの確認

`host-metrics.mjs` のcounter/marker/route集合と `production-entry.mjs` のimport Promiseはモジュール直下にあり、fetchごとの初期値代入はない。単体テストでも同一モジュールの要求番号1→2、factory load数1の継続を確認した。

生成SDKのWasmインスタンス作成は初回とRuntimeError後の回復関数にある。新しいWorkerEntrypointインスタンスの作成だけでは回復関数の再初期化条件は成立しない。今回の同一module再利用時はload数1を保ち、観測したSDK instance IDも後続ログで同じ値を保った。毎回Wasmを再ロードしているという証拠はない。一方、初回2件が別markerだった理由となるCloudflare内部のisolate配分までは特定できない。

## 検証と判断

候補のrelease実Worker/D1/RPC59件、release Rust2件、host6件、collector3件、fmt、production bundle dry-runが成功。通常production bundleにtest exportはない。

初回正常公開16/29msには10msへの余裕がなく、少数のwarm 2msを根拠に一般公開しない。正常な認証済みmutationのクラウドCPUは未検証。微調整をさらに重ねず、`cpu-adapter-proposal.md` の公開read専用JS/D1案を次の判断対象とする。承認・競合・本人認証等のRust維持を前提とし、公開GETだけ改善しても完成としない。

本人機能・メール・cron・削除は無効。公開サブドメイン・既存管理binding切替、追加資格情報、新サービス登録、push/mergeは行っていない。

## 実契約状態の読み取り

既存Wrangler認証を子プロセス内で通常利用し、LT accountの `/accounts/{account}/subscriptions` を一度GETした。HTTP **403**、Cloudflare error code **10000** により読み取りは拒否された。Workers Free/Paidの実契約は**未確認**。zoneプランやusage_modelから推定していない。新token、権限追加、契約変更、再試行はしておらず、秘密値は出力・保存していない。

CPU超過と自動課金を同一視しない。この資料の10ms gateは無料運用での実行打切りリスクを避けるための判定で、有料契約への変更許可を意味しない。
