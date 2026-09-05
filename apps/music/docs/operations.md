# 運用

## 開始と公開

本番公開前に実際の運営連絡窓口、プライバシーの保存期間・削除方針、音源と画像の利用条件を確定します。`CONTACT_URL` は権利・削除依頼を受けられる実HTTPS窓口にしてください。運営名や法的な保証は実装側で捏造していません。

初期運営のGitHub数値IDをSecret `BOOTSTRAP_ADMIN_IDS` に設定し本人がOAuthログインします。初回登録後はbootstrap設定を空にできます。新しい担当者にも一度ログインしてもらい、運営画面で名前とIDを確認して作品に割り当てます。所属解除・ロール変更は古いセッションでも次の操作から有効です。

作品担当者は他の同作品担当者が登録した曲も共同編集できます。登録者と作曲者は別です。運営の承認待ちはありません。409競合の場合、入力を控えて最新内容を読み、差分を適用してください。versionを書き換えて強制上書きしません。

作品・曲を保存してから、それぞれ公開します。公開済み曲の編集は下書きです。「更新を反映する」で一度に変更します。作品の公開がOFFなら、その中の曲が公開済みでも一般には配信されません。曲順は数値で変更し公開反映します。同じ曲順はID順で安定表示します。

## 取り下げと素材

曲の非公開化は公開スナップショットを外し、以降の一般アクセスを拒否します。作品を非公開または運営停止にすると作品画像・全曲の入口を停止します。担当者は運営停止を解除できません。配信済みの利用者のキャッシュや保存ファイルを回収できるとは説明しません。

同じ素材が別の公開曲・作品・有効広告でも使用されている場合、その参照が残る間は公開可能です。完全に取り下げるには全参照を外してください。バケットのr2.dev公開・Public Bucket・外部CDNによる無条件配信は有効にしません。APIの状態判定を経由してください。

アップロード再試行は新しいIDを作ります。失敗時のpending素材は公開できません。公開版が参照している旧音源は下書き変更を理由に削除しません。

## 広告

初期OFF。運営は作品画像または曲画像のアップロードで得た検証済み画像ID、HTTPSリンク、代替テキストをバナー設定へ入力します。広告は公開作品とは独立した参照です。広告OFFで余白の大きな枠を残しません。任意JS/HTMLは登録できません。

第三者広告SDKは未接続です。今後導入する場合、サービス審査、掲載ルール、プライバシー表示、必要な同意を運営が確認します。現在の初期バナーには行動追跡を実装していません。

## ログと保守

運営画面に最近100件の更新履歴を表示します。全履歴はD1 `audit_log`。一般投稿者が任意に追記・削除するAPIはありません。Worker障害ログは処理メソッド・APIパス・ランダムrequestIdのみを記録し、Cookie・トークン・OAuthコード・R2内部キーは出力しません。

期限切れセッション・OAuth途中状態・古い回数カウンターは、保守時間にD1で整理します。SQLの時刻はUnix **ミリ秒**、rate_limits.windowはUnix **分**です。監査ログの保管期間は運営が決定するまで自動削除しません。

```sql
-- 対象環境・バックアップを確認してから保守時に適用する。
DELETE FROM sessions WHERE expires_at < unixepoch()*1000;
DELETE FROM oauth_flows WHERE expires_at < unixepoch()*1000;
DELETE FROM rate_limits WHERE window < unixepoch()/60 - 1440;
```

## DBとR2のバックアップ・復元

本番用削除・復元コマンドは自動実行しません。D1とR2は別サービスなので、**組として同じ時点の参照を保全**します。

1. 投稿・公開の更新を運用で停止し、実行中アップロードを終了させる。
2. 対象環境のD1をexport。例：`npx wrangler d1 export MUSIC_DB --env production --remote --output <安全な保存先>/music.sql`。出力先をGit管理外にし、アカウント・監査・セッション情報を機密として扱う。
3. `assets` の全 `object_key` とメタデータを保管。非公開R2をS3互換の専用read権限で `aws s3 sync s3://pandd-music <安全な保存先>/r2 --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com` 等でコピー。認証情報は環境変数等で保持し、コマンド・Gitへ埋め込まない。
4. DB export日時・環境・R2 object manifest・ファイル容量とSHA-256を記録し、暗号化した保存先を保護。アップロード済みでDB未確定のオブジェクトも回収用に保管する。
5. 復元は**空の別D1と別の非公開R2**へ行う。R2の同じobject_keyを復元してからDBをimport。旧セッション・OAuth状態を破棄し、Bootstrapと実OAuthを再確認する。
6. 別staging環境で作品・曲・音源・画像・Range・公開停止を検証し、必要な件数・容量・ハッシュを照合してから運営判断で切替。

`sync --delete`、既存本番DBのDROP、本番バケットの一括削除をバックアップ手順に含めないでください。復元の実演は外部リソース未設定のため未実施です。

ローカルデモはサーバー停止後に `.wrangler/local/` 全体をコピーすればD1/R2をまとめて保全できます。Gitには追加しません。

## 孤立Asset整理

候補列挙は参照の有無を確認します。pending/failedでも1日以内は処理中の可能性があるため除外します。次のSQLは**読取専用**です。

```sql
SELECT a.id,a.object_key,a.status,a.bytes,a.created_at
FROM assets a
WHERE a.created_at < unixepoch()*1000 - 86400000
AND NOT EXISTS(SELECT 1 FROM games g WHERE
 json_extract(g.draft,'$.imageAssetId')=a.id OR json_extract(g.published,'$.imageAssetId')=a.id)
AND NOT EXISTS(SELECT 1 FROM tracks t WHERE
 json_extract(t.draft,'$.audioAssetId')=a.id OR json_extract(t.published,'$.audioAssetId')=a.id OR
 json_extract(t.draft,'$.imageAssetId')=a.id OR json_extract(t.published,'$.imageAssetId')=a.id)
AND NOT EXISTS(SELECT 1 FROM advertisement ad WHERE ad.image_asset_id=a.id);
```

削除する場合は更新を停止し、バックアップを取り、候補を再列挙します。IDとキーを1件ずつ照合してR2を削除し、成功を確認してDBの候補行を削除します。これは**本番データ削除**です。所有者判断なしに自動実行しません。公開停止だけでは素材が不要になったことを意味しません。
