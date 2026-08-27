---
layout: home
title: PandD Platform Docs
titleTemplate: false
hero:
  name: PandD Platform
  text: 開発・配信・運営のためのドキュメント
  tagline: Game LauncherとAdmin Webを、分離された信頼境界のまま安全に開発・公開するための正規ガイドです。
  image:
    src: https://raw.githubusercontent.com/koto-thing/GameLauncher/master/assets/images/PandDLogo.png
    alt: PandD
  actions:
    - theme: brand
      text: 開発を始める
      link: /guide/
    - theme: alt
      text: APIリファレンス
      link: /reference/
features:
  - title: Launcher
    details: Qt 6 / C++20ランチャーの構成、ビルド、CTest、Live2D、StagingとProduction公開。
    link: /guide/launcher-development
  - title: Admin Web
    details: Cloudflare Workers上の運営Control Plane。ローカル開発、検証、デプロイと権限モデル。
    link: /guide/admin-web-development
  - title: 配信の信頼境界
    details: Intake、Staging、Productionを混ぜず、署名済み成果物だけを公開する運用設計。
    link: /architecture/trust-boundaries
  - title: APIとSchema
    details: 実装から作成したAdmin HTTP APIと、配信契約を定義するcanonical JSON Schema。
    link: /reference/
---

## このサイトについて

このサイトはモノレポ内の `docs/` を唯一の原本として生成します。現在の実装と運用手順をナビゲーションへ掲載し、過去の計画書とエージェント引継ぎ資料は公開ナビゲーションから除外しています。

Store、Community、Platform APIは将来の実装領域です。現時点のREADME以上の機能はここでは扱いません。
