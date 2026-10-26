# 運営専用GitHubログイン

管理サイトはAdmin・幹部・幹部補佐だけが利用します。一般利用者の自動登録、一般利用者セッション、旧利用申請UI/APIは廃止します。過去の users、member_invitations、access_requests、監査データは削除しません。旧DB値 user は履歴・取消状態の保存値であり、アプリのロールとしては null（権限なし）です。

## 本人確認と招待

- /members の入力はGitHubユーザー名だけです。「GitHubで本人を確認」でGitHub本人ページを表示し、招待時にもサーバーが再取得します。利用者に数値IDの調査や入力は求めません。
- operator_invitations はGitHubから取得した数値ID・確認済み名・ロール・発行者のロール／許可世代に固定します。有効期間は7日間です。未受諾・未取消の招待は同じ本人に一件だけです。期限切れは次の招待時に取消状態になります。
- 幹部は補佐だけ、Adminは幹部／補佐を招待できます。直接Adminとしての新規招待は不可です。受諾済み運営のAdmin昇格はAdminだけが行えます。
- 未許可のGitHub本人はOAuth /user 確認後403となり、通常Cookieも users 行も発行しません。Device Flow／Bearer uploaderも同じ条件です。
- 招待された本人には10分の受諾専用Cookieを発行し、/invitations と /api/invitations で本人宛の一件だけ確認・受諾できます。readSession はこのCookieを常に拒否し、ゲーム／Music／メンバー／統計／Uploader等の運営APIには入れません。匿名用のログイン表示や設定メタデータは通常どおり返ります。
- 受諾時のD1 batch内で、固定IDと名、期限、取消、発行者の現在ロール・許可世代を再検証します。並行受諾は一件だけ成功します。発行者の降格・取消・削除、Admin操作による許可世代更新で旧招待は無効です。
- 同じbatchで users、platform_roles、operator_admissions、music_accounts と監査を更新します。Music側の本人作成が失敗した場合は全体をロールバックします。music_accounts.admin や作品別所属から権限を付与しません。
- Adminまたは発行者本人は未受諾招待を取り消せます。許可の取消は users を削除せずロールを無効にし、Cookie世代を更新します。最後の有効Adminを通常操作で降格／取消できません。

## ユーザー名変更と検知時点

許可名 operator_admissions.approved_login は、プロフィールの users.login_snapshot とは独立しています。大文字・小文字だけの差は同じ名前とします。名前と数値IDの両方が必要なため、旧名を別人が取得しても許可されません。

OAuthログイン時とDevice Flowの各本人確認で、現在のGitHub名を比較します。変更を観測するとその許可を失効させ、既存のWeb Cookieも次のリクエストから拒否します。通常WebリクエストではGitHubを呼ばず、D1のロール・取消・許可名・世代を毎回読み直します。そのためGitHub側の名前変更だけでは即時検出しません。未観測の既存Webセッションは、従来の最大6時間の再認証期限までは使える場合があります。受諾専用の本人証明は10分です。

再申請は新しいユーザー名をAdminへ連絡し、Adminが「名前変更を再承認」を発行します。GitHub数値IDで既存の運営本人を確認し、現在のロールを維持した招待にします。入力ロールでは昇格できません。本人がOAuthで新名を確認して受諾すると、許可名と世代を更新します。旧Cookieは復活しません。両Adminの同時改名・アカウント喪失は通常UIでは復旧できないため、下記の復旧手順が必要です。

GitHub API呼び出しは、事前確認と招待作成にそれぞれ一回、OAuth／Device本人確認に一回です。通常Webリクエストではゼロです。事前確認は公開プロフィールAPIを使うためレート制限や障害時は503として処理を止め、入力名だけで代用しません。

## 本番移行（このPRでは未実施）

対象は pandd-deployment-control-plane Workerと共通D1です。公開ゲーム配布、公開Music PHP、配信R2、bridge秘密鍵の設定は変更しません。

1. **実装結果・CIをレビューし、本番反映の別途承認を得る。** このPRをマージしただけで移行完了と扱わないこと。
2. Workerの現在バージョンとD1をバックアップする。既知基準はSHA 861ff655ee21b85041fcaf0fbf985e330f90bc4a／Worker 9dac05b0-96bc-422a-8fcf-0a8f7576a137 だが、反映直前に再取得する。バックアップ・本人一覧・秘密値はPRへ添付しない。
3. 管理操作・OAuthを一時停止する保守時間帯で、既存の運営ロールとGitHub本人を読み取り照合する。公開配信を停止しない。棚卸し後にロールや名前が変わった場合は棚卸しからやり直す。

   棚卸しSQL:

       SELECT u.github_user_id,u.login_snapshot,r.role
       FROM users u JOIN platform_roles r ON r.github_user_id=u.github_user_id
       WHERE r.role IN ('admin','executive','assistant')
       ORDER BY u.github_user_id;

   JSONをローカルに保存し、管理サイトのディレクトリで node scripts/check-operator-admissions.mjs ＜inventory.jsonのパス＞ を実行する。これは読み取り専用で、10名とGitHub数値ID／名前の一致、既知の両Adminを検証する。koto-thing（130458173）とmomiji1107（178362923）のAdmin継続を必須とする。他8名はRyotaIzumi、botamochi1111、isshi-1092、OHAYOGOMI、Aya-8、seikasan、Land-Eater、kabayaki944。**実際のロールは現在のDB値を維持し、推測して変更しない。** 件数・名前・ID・Adminが不一致なら中止し、経緯と正しい本人を確認する。
4. 隔離したバックアップコピーに drizzle/0007_operator_admissions.sql を適用して差分確認する。この追加SQLは既存の明示的運営ロールだけを許可名へ写し、ロールは変更しない。旧一般利用者・古い招待を許可根拠にはしない。0004 Musicスキーマを含む既存migrationが適用済みであることも確認する。
5. 本番で承認された手順により0007を適用し、**新Workerを出す前に**10名の許可名・ID・既存ロールが一致すること、両Adminが有効であることを再確認する。実行例は npx wrangler d1 migrations apply DB --remote（対象binding・アカウント・DB IDを先に確認）。ランタイムの ensureSchema は既存運営を自動許可しないため、migrationを省略すると全員ログイン不可になる。
6. 新Workerを反映する。旧Cookieは許可世代がないため全員再ログインが必要になる。既知の両Adminで通常ログインと一覧読み取りを確認する。本番で試験招待・権限変更は行わない。次に既存運営のログイン確認、管理外の公開ゲーム取得・Music一覧／再生の読み取り確認を行う。
7. 403・失敗監査を確認し、保守状態を解除する。operation_events に招待・受諾・取消・ロール変更・名前変更検知と拒否を記録する。CookieやOAuthトークンをログへ出さない。

古い member_invitations の未受諾招待は移行しません。本人名が確認されていないため、新画面から再発行します。

## 障害時とAdminのロックアウト

migration不足・名前不一致・GitHub障害は安全側に拒否します。単に「最初にログインした人」をAdminにする復旧経路はありません。

ログイン不可の場合は管理サイトを保守状態に保ち、D1バックアップと棚卸し結果を比較して修正します。旧Workerへの差し戻しは一般ログインを再び許してしまうため、アクセス制限を維持したまま行い、公開状態の単純ロールバックはしません。新しい招待・ロール変更が既にある場合はDB全体の復元で消さず、差分をレビューして前進修正します。

両Adminを失った場合は、GitHub側で固定数値IDと現在名を読み取り確認し、別途承認を受けた緊急DB修復として許可名・許可世代だけを更新します。ロール推測・旧名の別人への付与はしません。復旧操作は監査に記録し、再ログインで確認します。このPRに本番向けの自動復旧や実権限変更は含めません。
