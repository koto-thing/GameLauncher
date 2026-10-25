# 限定運営検証の準備と境界

2026-10-25 15:12:32 UTC、ユーザーは「運営のみ最大30分、非公開の架空開催1件・架空申請最大2件、終了時閉鎖と生成物だけの撤去」を承認した。まだ本番検証を開始していない。

## 実装した準備

- `LT_OPERATOR_API_ENABLED` を本人の `LT_PRIVATE_API_ENABLED` と分離した。未設定は双方false。production feature、LOCAL_AUTH禁止、既存在籍/role/Origin検証を維持する。
- `production-entry.mjs` のnamed `LtOperator` だけが運営gateを使う。公開HTTPへroleを付けてもRPCには到達しない。本人gateがfalseなら確認/申請HTTPは501のままで、token/outboxを生成しない。
- 管理routeは `LT_SYNTHETIC_METRICS=true` の場合だけ、既存のサーバー生成requestIdを `X-LT-Request-ID` と限定ログへ出す。actor、role、cookie、Authorization、本文は記録しない。ブラウザー指定IDは採用しない。
- RPC側は同じrequestIdで開始phaseと結果statusを記録する。計測collectorはHTTPとRPCをIDで厳密に結合し、欠落・重複・別version・status不一致を成功扱いしない。CPU打切りで結果markerがない場合も、記録された `exceededCpu` を消さない。
- `tests/production-gate*.toml` はlocalhost試験専用。既存の固定contextハーネスを使い、実OAuth認証の証明にはしない。本番構成にimportしない。

## 本番検証の開始条件

1. 対象SHAのCI成功、直前のAPI/管理Worker version・全設定の非秘密manifest、閉鎖手順、対象fixtureだけの撤去手順を準備する。他サービスの最新配備が変化したら停止して差分を確認する。
2. 通常所有者sessionを通常UIで確認する。URLは `https://pandd-deployment-control-plane.gotoukenta62.workers.dev/`。session不明時は通常ログインを案内し、cookie読出しや代用署名をしない。新scope/grant/roleを要求しない。
3. 専用D1の事前件数0と既知schema、送信mode=disabled、専用secretなし、本人/maintenance/cron/自動削除offを確認する。
4. 既存管理Workerの承認済み `LT_INTERNAL -> pandd-lt-api/LtOperator` だけを接続する。新しい公開bridge・別名binding・検証資格情報は作らない。通常運営権限の既存メンバーから見える可能性を前提にする。

gate有効化直前を開始時刻として、30分の絶対終了時刻と対象IDを記録する。所有者sessionや撤去の準備が不足している間は開始しない。

## 対象データと操作

最初は通常UIで架空開催1件を作成・保存する。タイトルに一意な検証run marker、会場は架空、公開開始/締切/開催日時は2099年に固定する。正常承認に `publishEnabled=true` は必要だが、public_opens_atの時刻gateで一覧非掲載・直接URL404を確認する。

架空申請のfixture投入は最大2件、メール/資料URLは `example.invalid` のみ。本人認証情報は作らず、本人の正式申請フローの検証とは区別する。必要な承認・再送・version競合だけを実行する。生成したoperationIdと本文は同じ再送にだけ再利用し、結果不明なら副作用を読取確認してから判断する。

申請の投入はsubmitted outbox、承認等は該当outbox・receipt・snapshot・auditを生成する。監査のactorには通常認証した実所有者IDが入る。mail mode=disabled、本人gate=false、maintenance=false、cronなし、secretなしを維持し、配送は行わない。

## collector

サービスディレクトリで、実際の配備versionを指定して購読を開始する。collector自身は要求を送らない。

```text
python tests/collect_operator_cpu.py --proxy-version <管理version> --rpc-version <API version> --seconds 180 --output .wrangler/operator-cpu-safe.json
```

必要なら通常UIで確認した非秘密のrequestIdだけをJSON配列にしたファイルを `--expected-ids` に指定する。指定なしでは観測した管理LT要求すべてを対象とするため、所有者の操作と断定しない。認証前拒否はdispatched=falseとしてRPC未呼出しと区別する。成功mutationのCPU、HTTP結果、outcome、自然なmodule再利用を確認し、初回10ms超過だけで失敗とせず1102/exceededCpuと継続超過を評価する。

## 閉鎖・撤去

終了、失敗、30分到達のいずれでも先に運営gateをfalseへ戻し、本人・mail・maintenance・cron・削除offを再確認する。必要なら管理Workerを記録済み直前versionへ戻す。新しい資格情報はないためcredential撤去は発生しない。

撤去は実行直前に既知schema、専用DB、run marker、対象開催ID1件・申請ID最大2件の完全一致、対象外申請が当該開催へ追加されていないことを検査する。対象のoutbox/配送job、receipt、audit、schedule/config操作記録、snapshot/marker、申請、開催関連だけを列挙して削除する。途中失敗・結果不明ならgateを閉じたまま残件を照合し、成功と記録しない。未知schemaや対象外recordがあれば停止する。

削除SQL/実行経路のローカル架空DB検証と、実際の対象manifestの確定は本番開始前の残件である。通常retentionの期限guardを緩めたり、本番削除exportを追加して代用しない。実ユーザーデータ・一般の認証記録・他開催・他サービスは削除しない。将来のメール有効化前に検証outboxが残っていないことも再確認する。
