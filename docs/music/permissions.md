# 本人確認と認可

GitHub `/user`による本人確認を共通化し、既存のRepository owner / write / admin / maintain条件を`gameAccess`へ分離した。リポジトリが読めなくてもMusic本人確認は成立するが、ゲーム許可は閉じる。Music運営は`music_accounts.admin=1`の明示登録。作品担当は安定GitHub数値IDの`music_memberships`。ログイン名、ログイン順、CollaboratorからのMusic自動付与はない。

| サーバー入口 | 必要条件 |
|---|---|
| GitHub start/callback | 署名state、10分期限、PKCE S256、固定Callback、GitHub本人確認 |
| `/api/auth/services` | 共通Cookie。利用可能な機能のboolのみ返す |
| `/api/dashboard` | 共通Cookie＋gameAccess。Music専用Cookieは403 |
| `/api/control` / ゲームIntake | 既存requireSession/requireRecentSession/requireUploaderActorでgameAccess必須、その後既存の役割・申請状態検証 |
| uploader Bearer / Device Flow | verifyGithubTokenで本人確認に加えて従来のゲームRepository条件必須 |
| `/api/actions/*` | 既存GitHub Actions OIDC・repository/workflow/environment等の機械条件。Music Cookieで代用不可 |
| `/api/music/session` | Cookieの本人情報と最新Music所属。ゲームdashboardを呼ばない |
| Music作品・曲・素材・公開・再試行 | 全要求で最新Musicアカウントと作品所属。操作IDから実scopeを解決 |
| Music作品作成・担当割当・広告・停止 | 最新Music運営権限。停止操作の再試行にも運営権限を要求 |
| PHP bridge | Music専用署名、期限、nonce、用途、対象ID、digest、期待版 |
| PHP公開API/media | 匿名可。現在snapshotの公開参照だけを配信 |

Musicのwriteは同一Originを必須とし、音源PUTにも適用する。更新120回/人/分、upload20回/人/分のD1制限。担当解除は次のAPIから反映。実行開始時に認可済みの処理を途中で強制切断するものではない。ゲーム権限変更の既存条件は維持する。

共通CookieはHttpOnly、SameSite=Lax、HTTPSではSecure、host-only、8時間。古いCookieにgameAccessがない場合は再ログインが必要。local-development Cookieはloopback＋LOCAL_DEV_AUTH=true以外で拒否。ログアウトは既存のCookie削除方式を再利用する（盗難済みCookieの個別サーバー失効リストは追加していない）。

本番更新前に`GITHUB_CALLBACK_URL=https://実control-plane-host/api/auth/github/callback`を設定し、既存GitHub Appの登録URLと一致させる。未設定ならログイン開始を安全に停止するため、**この設定をしないまま本番の共通認証を更新しないこと**。Device FlowのプロトコルやApp権限は変更しない。新しいOAuth Appやリポジトリ書込権限の付与は不要。

管理権限の初期登録、担当者追加、切戻しは[運用手順](operations.md)を参照。実GitHub Appによる本番ログインと既存Device Flowの実サービス往復は外部設定・実機確認待ち。
