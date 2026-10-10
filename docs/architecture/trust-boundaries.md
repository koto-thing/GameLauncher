# 信頼境界

| 環境 | 所有コンポーネント | 扱えるデータ | 禁止される能力 |
| --- | --- | --- | --- |
| platform | Store、Community、Platform API | Platform DB、Community DB、Analytics D1、UGC R2 | Intake、配信先書き込み、署名鍵 |
| distribution | Docs Portal、Launcher、Launcher配布ページ・取得Worker、Music公開UI、静的配信コンテンツ | 公開ドキュメント、署名済みManifest、公開downloads、公開音源 | DB書き込み、決済secret、署名鍵 |
| operations | Admin Web、Docs Editor Worker、Intake Uploader、Publisher | Deployment DB、Docs専用D1、非公開Intake | Platform session secret、Platform DB直接操作 |

## Intake / Staging / Production

プレイ統計の公開受付と統計専用D1は `services/platform-api` が所有する。Launcherは任意の
同意に基づきAPIへ送信し、DBのbindingや書き込み資格情報を持たない。Admin WebはAdmin権限を
確認した後、`PLATFORM_API` Service Bindingと読取専用secretで集計APIだけを呼ぶ。
Deployment DBとの共有・直接アクセスは禁止する。統計送信の障害はゲーム起動を妨げない。

Music管理UIは既存Admin Webに組み込み、認証・権限・D1更新はoperations側で実行する。Music公開UIはレンタルサーバーの同一originだけを参照する。PHPの署名受信口・非公開保存については[Music構成](../music/architecture.md)を参照。

Intakeは未検証Artifactを置く非公開領域です。Stagingは検証用の配信環境、Productionは利用者向け配信環境です。bucket、資格情報、署名鍵、GitHub Environmentを分離し、ProductionはStaging成功物の同一性を確認して昇格します。

信頼境界を変更するときは `infrastructure/trust-boundaries.json` と [プラットフォーム構成](../PLATFORM_ARCHITECTURE_JA.md) を同じ変更で更新し、構成境界テストを実行します。
