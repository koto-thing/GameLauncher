# LT API 実装状況

これは未完成の安全な入口のみ。業務 API は 501、公開入口の運営 URL は 404。認証・申請・承認を成功扱いにしない。

管理接続予定: 別の workers.dev 無効・公開 route なし Worker にサービス binding で接続する。現在その Worker は未実装。公開 Worker に actor header による認可を追加しない。proxy は毎回在籍と admin/executive/assistant を再検証し、ブラウザー由来 actor 情報を破棄する。メール変更は admin/executive のみ、本人確認手順未確定のため未対応を維持する。

確認リンク1時間、session24時間は後者のみ設定可能な提案。現在 token/session 発行なし。メール送信、DB 接続、削除、外部資料 fetch は実装していない。

未実装: D1 migration、公開 snapshot、時間割、本人申請、token POST 交換、状態遷移、outbox fake adapter、保持 dry-run、全受入テスト。SQLite だけの試験を D1 実機ローカル検証として代用しない。

公式確認: https://developers.cloudflare.com/workers/languages/rust/ 、https://developers.cloudflare.com/d1/worker-api/d1-database/ 。worker 0.8.7 は cargo search で公式 registry 確認。D1 batch は UPDATE 0件で停止しないため、業務実装時は勝者 receipt に副作用を従属させる必要がある。

bundle/CPU は未計測。無料枠適合は未保証。クラウド試験・本番操作なし。

共有追補 7c0e93d87250ba4f6be200d0ff9e3e260f9a707b を cd2fd50 として取り込み済み。具体的 mutation 型、OperatorContext、承認の親 version を確認。業務 API 実装にはまだ到達していない。
