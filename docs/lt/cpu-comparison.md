# LT 専用APIのCPU比較

2026-10-25。公開切替のCPU gateは未達。一般サブドメイン、既存管理binding、メール、cron、自動削除は有効化していない。

## 比較条件

- 同じ空の専用D1、同じ3経路へ各3回の逐次GET。本人機能は無効、送信modeはdisabled。
- baseline: `f4ab59ef144a191fdef73472ac2e93f0d75e10cc` のクリーンarchive、version `38f9db4f-4eb0-4ae8-ae94-ef996d1d92d4`。
- candidate: `301cbd304a15e71391ff75b583f8e7af7984c230`、version `e6752fbc-146d-4118-97a7-b54a2167ed2f`。
- tail JSONの実 `cpuTime` / `wallTime` を使用。起動時間やHTTP往復時間をCPUと扱わない。
- 非秘密の合成ID・sequence、version、route、statusで照合。queryの値だけに依存した旧収集器は照合0件で失敗した。別要求の推定結合はしない。
- 配列・複数行JSON・NDJSON・案内ログ混在、無関係な要求、version/必須metric/marker欠落をローカルfixtureで検証。
- `firstInIsolate` は同じモジュールでの最初の観測を示す。V8全体のcoldを断定しない。公開一覧は両版とも3件すべて初回であり、公開一覧のwarm値は未取得。

| 経路 | baseline CPU ms | candidate CPU ms | baseline wall ms | candidate wall ms |
| --- | --- | --- | --- | --- |
| 公開開催一覧200 | 34, 19, 25 | 39, 27, 26 | 584, 444, 483 | 243, 167, 161 |
| 無効session501 | 9, 20, 1 | 0, 1, 2 | 9, 25, 2 | 1, 2, 3 |
| 運営HTTP404 | 17, 18, 7 | 0, 0, 0 | 21, 20, 8 | 1, 1, 0 |

拒否経路はWasmをロードする前に既存status/JSONエラー/no-store/no-referrerを返す。許可する処理と業務認可はRustへ渡す。公開一覧のlifecycle更新と期限payload消去は一つのD1 atomic batchへまとめた。wallは短縮したが、公開一覧のCPU改善は確認できず、10msを超える。

## 検証と残件

- 候補のローカル実Worker/D1/RPC: 14 suite、59件成功。開催開始/終了・保持期限・異種競合・メール変更と、batch途中失敗時のstate/snapshot rollbackを含む。
- lifecycle実Worker7件、host5件、collector3件、production Rust2件、fmt成功。
- production feature + 遅延wrapperを専用空ローカルD1で起動し、実HTTPの200/501/404とヘッダーを確認。
- 本番bundle dry-runで遅延ロード内のWasm初期化とテストexport不在を確認。通常版/開発版の従来CI成功は過去SHAの証拠であり、新候補のCI成功とはしない。
- 正常公開、認証済みmutationとも無料CPUの余裕を確認できていない。mutationのクラウド計測は未実施。新しい資格情報や固定roleの公開テストproxyは作っていない。
- 次の検討はRust release LTO/size調整と初回実行負荷の分析。キャッシュで中止・保持期限を遅らせたり、認可を外したりしてgateを通さない。

生のrequestヘッダーやtokenを保存せず、選択した数値とphaseだけを `cpu-baseline-marked.json` / `cpu-candidate-batch-lazy.json` に残す。小規模比較のため統計的な安定性や一般本番の性能を保証しない。
