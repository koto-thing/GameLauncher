# Business modules

`modules`は共有ユーティリティ置き場ではなく、PandDの業務境界を示す。

- `identity`: PandDアカウントと認証
- `catalog`: ゲーム、DLC、OST、価格表示情報
- `commerce`: 注文、決済、返金
- `entitlements`: 購入・付与・失効による所有権
- `community`: 投稿、コメント、リアクション、フォロー
- `moderation`: 通報、BAN、非表示、監査
- `notifications`: アプリ内通知と配信状態

実装は当初`services/platform-api`に配置してよいが、この境界を越えたテーブル更新は禁止する。
共有が必要なデータは、公開APIまたは`packages/contracts`に定義したバージョン付きイベントで渡す。
