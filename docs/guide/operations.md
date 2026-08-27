# 運用・障害対応・監査

## 通常運用

- 変更可能なIntakeと、読み取り専用の配信先を分離する。
- StagingとProductionでEnvironment、承認者、署名鍵、R2資格情報を共有しない。
- Productionは成功済みStagingと同じArtifact ID、SHA-256、metadataだけを昇格させる。
- GitHub ActionsのOIDC claim、commit SHA、run IDをControl Planeのattemptへ結び付ける。
- 監査eventはハッシュチェーンを維持し、上書きしない。

## 障害時

新規dispatchを止め、Control Planeのrequest、attempt、GitHub Actions run、公開先objectの順で状態を照合します。公開pointer更新前の失敗は原因を修正して再試行でき、pointer更新後に整合性を証明できない場合は `recovery_required` としてAdminがR2確認内容を記録してから再試行を許可します。

秘密情報をログ、issue、スクリーンショットへ貼り付けません。漏えいが疑われる場合は先に資格情報を失効・ローテーションします。

詳細なrunbook、ロールバック、監査証跡は [Distribution operations](../OPERATIONS.md) を参照してください。
