# PandD Platform概要

PandDは単一モノレポを維持しつつ、実行時の信頼を「一般利用者」「配信」「運営」の3環境へ分離します。ソースの近さを権限共有の理由にはしません。

設計判断の文章上の正本は [PandDプラットフォーム構成](../PLATFORM_ARCHITECTURE_JA.md)、機械可読な所有関係の正本は `infrastructure/trust-boundaries.json` です。

## 現在の範囲

- `apps/launcher`: 配信環境の読み取り専用クライアント
- `apps/admin-web`: 運営環境の申請・承認Control Plane
- `services/deployment_publisher`: 検証・署名・公開
- `packages/contracts`: Launcher/Publisher/Adminで共有する契約

Store、Community、Platform APIは設計上の将来領域であり、現在はREADMEのみです。

## 依存方向

Launcherは署名済み配信物だけを信頼します。Admin Webは運営申請とIntakeを所有しますが署名秘密鍵や公開先書き込み権限を持ちません。PublisherだけがGitHub Environment内で検証済みArtifactを署名・公開します。
