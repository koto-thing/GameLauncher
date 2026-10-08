---
title: ゲームを公開する
description: ゲームランチャーにゲームを公開する方法を説明します
---
# ゲームを公開する

## 🚨注意🚨
ゲームを公開するには、インターネット上にゲームをアップロードする必要があります  
詳しくは、[Web Uploader / Intakerの使い方](/guide/game-deployment)を参照してください

## STEP 1
![GameReleaseApplication01](/images/uploads/a07626f4c77f68fe4df1863ae8e0926cab41ad48.png)
[申請ページ](https://pandd-deployment-control-plane.gotoukenta62.workers.dev/game)より、**新しい申請**を選択してください

## STEP 2
![GameReleaseApplication02](/images/uploads/963d03ba3f448e31449dac23afc00520138c6e06.png)
Web Uploader / Intakerで作成した、.pandd-artifact.jsonを読み込ませてください  
例：(文字列).pandd-artifact.json

以下の画像のようになれば、成功です  
**申請を作成**を押して、申請を作成してください  
![GameReleaseApplication03](/images/uploads/c64b388d4d09f5f79018bd097334d06b5e320928.png)


## STEP 3
![GameReleaseApplication04](/images/uploads/f3e53db7ccd67d916530dacc12b9ae5760456f26.png)
![GameReleaseApplication05](/images/uploads/b04d6f34728087f1c848deb0d1259dcfb9af8b31.png)
![GameReleaseApplication06](/images/uploads/d9d5734ded8da180a1753076937e2a3645be30be.png)
![GameReleaseApplication08](/images/uploads/3be66aba8c754046f1295a844002c8129bc8301a.png)

### STEP 3-1
申請は大きく２段階に分けられます  
各申請の状況は、申請画面の左側のUIから確認してください
* STAGING
    * 本番公開前の仮公開です
    * デバッグ環境のゲームランチャーのみからアクセスが可能になります
* PRODUCTION
    * 本番公開です
    * すべてのユーザーからアクセスが可能になります

### STEP 3-2
申請に対する承認が必要になります
* 承認者は、このレポジトリのCollaboratorかつ、Adminが指定したユーザーのみ申請に対して承認することができます
* 申請期間(1週間)を過ぎると、申請やり直しとなる点に注意してください
* 承認者は、申請画面の右側、画像右の黒塗り部分から承認を行ってください

### STEP 3-3
承認後、**STAGING or PRODUCTIONへ実行**を押してください
![GameReleaseApplication07](/images/uploads/db4152cf9329a52f1682455445750276ac90cea4.png)

### STEP 3-4
STAGING、PRODUCTIONともに以下の表示がされたら成功です
![GameReleaseApplication09](/images/uploads/36944150af24dc8168da2dc2d57091bb7dcce1f0.png)
