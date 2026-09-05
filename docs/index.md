---
title: PandD Platform Docs
description: Game LauncherとAdmin Webを、分離された信頼境界のまま安全に開発・公開するための正規ガイドです。
manual:
  title: PandD Platform 操作・開発マニュアル
  description: Game LauncherとAdmin Webを、分離された信頼境界のまま安全に開発・公開するための正規ガイドです。
  entries:
    - title: はじめて開発する
      description: 環境の準備、リポジトリの構成、ローカルでの起動。
      link: /guide/
    - title: Launcher
      description: Qt 6 / C++20ランチャーの構成、ビルド、CTest、Live2D、StagingとProduction公開。
      link: /guide/launcher-development
    - title: Admin Web
      description: Cloudflare Workers上の運営Control Plane。ローカル開発、検証、デプロイと権限モデル。
      link: /guide/admin-web-development
    - title: ゲームを配信する
      description: Intake、Staging、Productionを分け、署名済み成果物を公開する。
      link: /guide/game-deployment
    - title: 配信の信頼境界
      description: Intake、Staging、Productionを混ぜず、署名済み成果物だけを公開する運用設計。
      link: /architecture/trust-boundaries
    - title: APIとSchema
      description: 実装から作成したAdmin HTTP APIと、配信契約を定義するcanonical JSON Schema。
      link: /reference/
---

## このサイトについて

このサイトはモノレポ内の `docs/` を唯一の原本として生成します。現在の実装と運用手順をナビゲーションへ掲載し、過去の計画書とエージェント引継ぎ資料は公開ナビゲーションから除外しています。

Store、Community、Platform APIは将来の実装領域です。現時点のREADME以上の機能はここでは扱いません。
