# LT公開前の確認（2026-10-25）

PR: https://github.com/koto-thing/GameLauncher/pull/129 。完成機能の基準は `4c9e809`。以下は配備準備であり、本番設定・secret・実メール・本番削除の実行記録ではない。

## 承認された構成（設定は未実行）

- 公開先候補: `lt.koto-thing.com`。所有するactive zoneと既存DNS競合を配備前に確認し、既存メールDNSは変更しない。
- 新規公開Worker `pandd-lt`: 静的assetを直接配信し、`/api/lt/*` だけWorkerを実行する。`LT_PUBLIC` は新規 `pandd-lt-api` の公開fetchへ接続する。一般の運営API経路は外側・Rust双方で404。
- 既存管理Worker: 現行GitHub認証・在籍・role確認を維持し、`LT_INTERNAL` を `pandd-lt-api#LtOperator` へ接続する。ブラウザーのactor/role/Authorizationを内部へ渡さない。既存の権限やOAuth grantを追加しない。
- 新規専用D1 `pandd-lt`: 既存管理D1と分離する。現アカウントにはD1が4個、公開メタデータ上の合計は約2.7MB。日次消費量、実プラン、既存cron数の実値は別途確認する。
- メール中継候補: `https://pandd-music.koto-thing.com/lt-mail.php`。既存Music全体を再配備せず、LTの入口とWeb外の専用設定・receipt領域を分離する。
- 2026-10-25 12:57 UTCに専用鍵の新規生成・API/PHP両端設定、`info@koto-thing.com` から `panddmail@gmail.com` への確認メール1通が承認された。件名は「LT会 メールアドレスの確認」、1時間の確認リンクと問い合わせ先を含める。既存Music鍵を流用しない。secretをコード・ログ・公開artifactに含めない。
- 本番不可逆削除は未有効化のまま。今回の公開承認に物理削除の有効化は含まない。

## D1とWorkers Freeの境界

[D1公式limits](https://developers.cloudflare.com/d1/platform/limits/) のBatch limitsは、`db.batch()` 全体をinvocationのquery上限に対して1回と数える。SQL文ごとに50回枠を消費する扱いではない。

現行のローカル実行buildで、`src/retention.rs` の外側D1 API呼出し数は次のとおり。batch内部の38文／10文と分けて扱う。

| 経路 | 時刻lookup | schema/anchor確認 | 件数確認 | atomic batch | 合計 |
| --- | ---: | ---: | ---: | ---: | ---: |
| イベント削除 | 1 | 1 | 1 | 1 | 4 |
| 独立認証掃除 | 1 | 1 | 0 | 1 | 3 |

50 D1 API呼出し制限内であり、原子性を崩す分割は不要。Workersのinternal subrequest上限とは混同しない。日次rows read/write、各SQLの長さ・パラメータ上限、実行時間の制限は引き続き別に適用される。実際の行消費はD1のmeta値で確認する。

[Workers公式limits](https://developers.cloudflare.com/workers/platform/limits/) に基づき、Freeの10ms CPUをHTTP・cronともに配備gateとする。wall timeやローカルCPU時間をクラウドのcpuTimeとして報告しない。無料枠を超える構成は公開せず改善する。課金プランを切り替えない。

## 独立して完了した確認

- 公開proxy: Node 3 tests成功。Cookie/Origin/CSRFを維持し、偽造role/actorとAuthorizationを除去、管理404、未接続503、内部エラー非露出を確認。
- 公開UI build・Wrangler deploy dry-run成功。Worker本体1.34KiB、gzip 0.58KiB。実配備はしていない。
- CSP下の実ChromeでPC/390pxの未接続画面表示と横溢れなしを確認。
- ローカルの実asset配信で `/`・開催SPA・確認画面200、確認画面no-store、no-referrer、nosniff、CSP、運営404・未接続503を確認。
- PHP無送信検証スクリプトはPython構文確認済み。STORM-PCにPHP CLIはなく、PHP本体の実行は未検証。専用CI草案ではPHP構文と配送前拒否経路のみを試す。

## 本番接続に必要なコードと実行順

1. CI担当の成果を統合し、一般管理テストと実Workerを起動する専用LT CIの両方を成功させる。ローカル前提の実結合テストを検証なしで省略しない。
2. 本人・運営APIの開発限定gateを、試験exportを含まない明示的な本番gateへ分離する。現在の通常bundleは501で閉じる。
3. `src/mail.rs` のAPI dispatcherは現状fake modeだけを選ぶ。HTTP transport本体は実装済みだが、承認したrelay URLとsecretを渡す本番アダプター接続が必要。未設定なら送信不能を維持する。
4. 承認済みの専用D1を作り、新規空DBに0001〜0029・0030・0040の31 migrationを適用する。既存管理DBへLT migrationを流さない。
5. メール無効の隔離構成で、新規Workerの少量の架空リクエストを逐次実行し、クラウドログのcpuTime、D1の行消費と安全な拒否を確認する。実際の上限内動作が確認できるまで一般公開しない。
6. 公開ホスト・管理bindingを接続し、既存GitHub認証の回帰と匿名／本人／運営の境界を確認する。PHPは無送信の拒否経路、設定領域の非公開性を確認してから専用鍵を設定する。
7. 承認された1通だけを送り、確認リンクのGET非消費・POST交換・期限・受信を確認する。送信失敗／結果不明で無制限に再送しない。

## 切戻し

既存管理Workerの配備versionとbinding構成を変更前に記録し、不具合時は通常のWorker rollbackで戻す。新規公開Workerのrouteを外し、mail modeはdisabledへ戻す。LT D1は消さず保持し、既存MusicファイルやメールDNSは変更しない。データ投入後にmigrationを破壊的に巻き戻さない。初回公開と不可逆削除の有効化を同じ作業にしない。
