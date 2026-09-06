# PandD Music — control-plane統合版

変更仕様を優先し、元指示書のプレーヤー・画像・デザイン・ドメイン検証を継承した。仕様原文2点はこのディレクトリに保存している。本番公開は実施していない。

## 境界

```text
管理ブラウザー → 既存control-plane /music・/api/music/*
                  ├ 共通GitHub App・Cookie → Musicの現在所属をD1で認可
                  ├ 既存DBのmusic_*：下書き・素材情報・公開処理・監査
                  └ 署名HTTPS → PHP bridge → 私有素材・公開snapshot

一般ブラウザー → レンタルサーバー
                  ├ 静的HTML/CSS/JS
                  ├ PHP public API → ローカル現在snapshot
                  └ PHP media → 現在公開判定 → 私有ファイルをstream配信
```

公開ページ・catalogue・画像・再生・シーク・ループにWorkers/D1/GitHubへの通信はない。公開JavaScriptに管理アプリ・認証SDK・秘密値を含めず、公開APIはCookieを要求しない。管理プレビューは同一control-plane originの認可済みAPIを使用する。

## コードと依存方向

| 場所 | 責務 |
|---|---|
| `apps/music/src/domain` | 純粋な作品・曲・クレジット・素材・ループ・権限ルール |
| `apps/music/src/application` | 再利用した編集Use Case、Player、保存・配信Port |
| `apps/admin-web/music/application` | upload、公開処理・再照合のUse CaseとPort |
| `apps/admin-web/music/infrastructure` | 既存D1、現在権限、固定PHPへの署名転送 |
| `apps/admin-web/music/composition` | 既存DB、Use Case、Adapterの結線 |
| `apps/admin-web/app/music` | 既存vinextの管理入口、管理Reactアプリのmount |
| `apps/music/src/presentation/web` | 再利用した公開UIと管理UI。別entryでbundleを分離 |
| `apps/music/src/infrastructure/audio` | HTMLAudio / Web Audio、1曲ずつのPCMデコード |
| `server/music/src` | Signature、Assets、Store、Publications、Media |
| `contracts/music` | プロトコルv1、投稿制約 |

DomainはReact/HTTP/DB/Web Audioを参照しない。PresentationはUse Caseを呼び、InfrastructureはPortを実装し、Compositionで結線する。共有のためのリポジトリ再編は行っていない。

管理ビルドはIIFEとして既存control-planeの`public/music-editor`へ生成し、`/music`のhydration後にmountする。公開ビルド`apps/music/dist`には含めない。Reactは各entryで重複解決しない設定にしている。公開プレーヤーはアプリ全体で1個、管理試聴は管理アプリ全体で1個。

## 保存と公開

D1の下書きが管理元、PHPの現在snapshotが配信の事実。公開操作はD1へ不変本文・digest・期待版を記録し、PHP receiptの照合後だけ公開列を確定する。下書き保存は公開列を変更しない。公開処理は既存ゲームのdeployment_requestsや承認フローを使用しない。

新規migrationは`apps/admin-web/drizzle/0004_music.sql`。既存migration・ゲーム用テーブル・binding・R2・監査チェーンを変更しない。MusicのSQLはこの追加migrationと専用D1 Adapterで管理する。既存のDrizzleモデルからMusicのDDLは生成しないため、Musicスキーマ変更は次の連番SQLを追加する。`wrangler d1 migrations apply`で既存と同じ履歴へ適用する。

独立Music Worker、OAuth、R2 Adapter、旧ローカルサーバーは除去した。旧Music migrationは過去実装の資料として残しており、新しい起動経路では実行しない。外部R2や旧DBの削除・自動移行は行っていない。

## 今回の対象外

投げ銭・動画・ランチャー本体の変更・リンク追加は未実装。将来の投げ銭はサイト全体の運営費に使い、作曲者・作品ごとの分配はしない方針だけを記録する。
