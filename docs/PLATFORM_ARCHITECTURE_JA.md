# PandDプラットフォーム構成

## 方針

PandDは1つのモノレポで管理する。ソースコードの配置と実行時の権限境界は別のものとして扱い、
デプロイ、資格情報、データストアを3つの信頼環境に分離する。

最初は`platform-api`内のモジュラーモノリスとして実装する。独立したスケール、障害分離、
担当チームまたはリリース周期が必要になったモジュールだけをWorkerへ分離する。

## 3つの信頼環境

### 1. 一般利用者環境（platform）

- 対象: `apps/store-web`、`apps/community-web`、`services/platform-api`
- 保持可能: 一般ユーザーセッション、Platform DB、Community DB、UGC用R2への限定Binding
- 禁止: Intake、公開先R2、署名鍵、GitHub Actions実行権限へのアクセス
- 認証: PandDアカウント。運営者用GitHub認証を流用しない

### 2. 配信環境（distribution）

- 対象: `apps/launcher`、`services/distribution-content`
- 保持可能: 公開Manifest、公開ゲーム、公開画像、公開OST
- 禁止: DB書き込み権限、決済資格情報、署名秘密鍵、Intakeへのアクセス
- ランチャーは署名済みManifestとPlatform APIの所有権判定だけを信頼する

### 3. 運営環境（operations）

- 対象: `apps/admin-web`、`apps/intake-uploader`、`services/deployment_publisher`
- 保持可能: 運営者セッション、Deployment DB、非公開Intake R2への限定Binding
- 署名鍵と公開先R2書き込み資格情報はGitHub Environment内のPublisherだけが使用する
- 一般ユーザー向けのCookieやPlatform DB資格情報を保持しない

具体的な所有関係は`infrastructure/trust-boundaries.json`を正とする。

## 業務モジュール

| モジュール | 所有する情報 | 外部へ公開する結果 |
| --- | --- | --- |
| Identity | PandDアカウント、外部ID、セッション | `userId`、認証結果 |
| Catalog | ゲーム、DLC、OST、価格表示情報 | 商品情報 |
| Commerce | 注文、支払い試行、返金 | 確定した購入イベント |
| Entitlements | 所有権、付与、失効 | 利用・ダウンロード可否 |
| Community | 投稿、コメント、リアクション、フォロー | 公開投稿と関係情報 |
| Moderation | 通報、制裁、削除判断、監査 | 可視性と利用制限 |
| Notifications | 通知、配信状態 | ユーザー向け通知 |

各モジュールだけが自身のテーブルを更新する。他モジュールのテーブルを直接更新しない。
同期処理は公開インターフェース、非同期処理はバージョン付きイベントを使う。

## 主要フロー

購入処理は`Commerce -> purchase.completed -> Entitlements -> Notifications`とする。
決済Webhookは冪等に処理し、クライアントから送られた決済完了状態を信用しない。
ランチャーとOSTダウンロードは注文ではなくEntitlementsへ問い合わせる。

投稿処理は`Community -> Moderation -> Notifications`とする。投稿・コメント公開時点から
通報、非表示、BAN、監査を利用できることを必須とする。

## データ所有

- Deployment DB: 運営申請、承認、監査。既存D1を継続利用する
- Platform DB: Identity、Catalog、Commerce、Entitlements
- Community DB: Community、Moderation、Notifications
- R2: ゲーム、OST、商品画像、UGC。用途ごとにBucketとBindingを分離する

Platform DBとCommunity DBを同じ物理PostgreSQLから開始してもよいが、論理スキーマ、
DBロール、migration所有者は分ける。アプリ間で共通DBロールを使わない。

## 依存規則

1. WebアプリはDBを直接操作せず、所有モジュールのAPIを呼ぶ。
2. `Commerce`は所有権を直接更新せず、購入イベントを発行する。
3. `Entitlements`は決済プロバイダーへ直接問い合わせない。
4. `Community`はアカウント情報を複製せず`userId`だけを参照する。
5. `Notifications`の失敗で購入、所有権付与、投稿をロールバックしない。
6. OperationsからPlatformへ接続する場合も専用APIを使い、DB共有をしない。
7. Workerを分離した場合は公開URLではなくCloudflare Service Bindingを使用する。

## 実装順序

1. IdentityとPandDアカウント
2. Catalog
3. CommerceとEntitlements
4. Store Webとランチャーの所有権連携
5. CommunityとModeration
6. Notifications

リアルタイムチャット、検索、おすすめは、投稿とモデレーションが安定してから追加する。
