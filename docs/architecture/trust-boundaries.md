# 信頼境界

| 環境 | 所有コンポーネント | 扱えるデータ | 禁止される能力 |
| --- | --- | --- | --- |
| platform | Store、Community、Platform API（将来領域） | Platform DB、Community DB、UGC R2 | Intake、配信先書き込み、署名鍵 |
| distribution | Docs Portal、Launcher、静的配信コンテンツ | 公開ドキュメント、署名済みManifest、公開downloads | DB書き込み、決済secret、署名鍵 |
| operations | Admin Web、Intake Uploader、Publisher | Deployment DB、非公開Intake | Platform session secret、Platform DB直接操作 |

## Intake / Staging / Production

Intakeは未検証Artifactを置く非公開領域です。Stagingは検証用の配信環境、Productionは利用者向け配信環境です。bucket、資格情報、署名鍵、GitHub Environmentを分離し、ProductionはStaging成功物の同一性を確認して昇格します。

信頼境界を変更するときは `infrastructure/trust-boundaries.json` と [プラットフォーム構成](../PLATFORM_ARCHITECTURE_JA.md) を同じ変更で更新し、構成境界テストを実行します。
