# ロリポップ本番デプロイ結果（2026-09-06）

## 公開先と管理

- 公開: https://pandd-music.koto-thing.com/
- 管理: https://pandd-deployment-control-plane.gotoukenta62.workers.dev/music
- 既存GitHub OAuthでログインし、koto-thing（GitHub ID 130458173）のMusic運営画面を実ブラウザーで確認。
- Music管理の初期運営は上記アカウントだけ。ゲームの権限は今回追加・変更していない。
- control-planeのデプロイ版: `0f4a4353-2162-4ac0-9eb9-223df18ded37`。

## 配置と秘密管理

同日実施したPHP限定の再デプロイ後は、稼働PHP本体が `/home/users/2/sub.jp-koto-thing/pandd-music-private/releases/php-20260906-35b10cefc88b/app` にある。下表の初回 `app` は旧版として保持。公開側api.php/bridge.phpは新しい版のbootstrapを参照している。

| 内容 | サーバー内の配置 |
|---|---|
| 公開ファイル | `/home/users/2/sub.jp-koto-thing/web/pandd-music` |
| PHP本体・依存・非公開設定 | `/home/users/2/sub.jp-koto-thing/pandd-music-private/app` |
| 下書き音源・公開状態・受領記録 | `/home/users/2/sub.jp-koto-thing/pandd-music-private/data` |

PHP本体とデータは、Musicだけでなく共通の `web` ルートより外に配置。公開側api.php/bridge.phpのbootstrap参照を上記非公開アプリへ合わせた。再配布時も一般パッケージの `../src/bootstrap.php` をそのまま上書きしないこと。

転送元は `apps/music/.env` のFTP_SERVER・FTP_USERNAME・FTP_PASSWORD・PUBLIC_FOLDER・OVERWRITE。PUBLIC_FOLDERはpandd-music、OVERWRITEはtrueだった。PythonのFTPS接続にリセットが発生したため、証明書検証を維持するcurlのFTPSへ切り替えて公開ファイルを転送した。フォルダ全体の削除同期は行っていない。

FTPから直接置けない非公開アプリは、期限付き・認証付き・配布物SHA-256固定の一時PHPを介してHTTPS転送し、Web外へ展開・初期化した。一時PHPと転送途中の一時ファイルは撤去済み。既存アプリがある場合は初回インストーラーが上書きを拒否する構成で実施した。

専用MUSIC_BRIDGE_SECRETをPHPの非公開config/local.phpと既存Worker Secretへ設定。復旧用の値はGit除外済みの `apps/music/.env` にも保存した。FTPパスワードとは別の鍵で、値は報告・コード・公開物へ出していない。作業用buildにも秘密を含む配布物があるため、GitHub artifacts等へフォルダ丸ごとアップロードしない。

DBは変更前に `build/music-deploy/control-plane-before.sql` へバックアップし、未適用だった0004_music.sqlだけを追加。既存のIntake binding、ゲーム承認・Actions設定、既存Secretsを保持した。

## 実環境で確認したこと

- TLS証明書検証付きでHTTPS接続成功。PHPは8.5.10、fileinfoとGDのJPEG/PNG/WebPに対応。
- Music用 `.user.ini` にmemory_limit=256M、max_execution_time=120、display_errors=Offを配置。元の環境確認時は128M。最大画像デコードの負荷試験は未実施。
- 管理画面から確認用作品・曲・曲画像・クレジット・1〜3秒ループを登録、下書き保存、曲公開、作品公開に成功。人の公開承認は追加していない。
- 公開前の画像URLが404であることを確認。
- 公開サイトの390px表示、曲画像、直リンク、実音源再生、区間ループを確認。
- 音源HEADは200、Rangeは206（44バイト指定を確認）。公開APIと音源にはno-store。
- Cloudflareが自動挿入する解析スクリプトを検出し、HTMLに `Cache-Control: public, max-age=0, must-revalidate, no-transform` を設定して挿入を停止。再検証のブラウザー通信16件はすべて公開origin内、外部通信0、未処理例外0。管理Workerへの通信なし。
- `.user.ini`、config、src、vendorなどの公開URLは403/404。
- 作品非公開化後、公開カタログから消失。元音源のGET・HEAD・Rangeがすべて404となった。
- 管理画面から64MiB（67,108,864 bytes）のPCM WAVを非公開登録し、D1でverifiedと判定されたことを確認。約349.525秒、48kHz・2ch。PHP設定画面の20Mだけで拒否される構成ではなかった。
- 公開操作3件はすべてappliedで確定。今回、本番で故障を注入した再試行テストはしていない。ローカルの回復テスト結果は既存test-report.mdを参照。
- 既存control-plane回帰84件すべて合格。追加した本番検証スクリプトのLint・アーキテクチャ検査も合格。

通信・画面の証跡は `apps/music/build/rental-production-verification.json` と `rental-production-390.png`。非公開化の検証は `build/music-deploy/unpublished-verification.json`。

公開中の確認作品に対する再検証コマンドは `apps/music` で `node scripts/verify-rental-deployment.mjs <作品UUID>`。現時点では確認作品を非公開に戻しているので、再公開せずそのまま実行すると失敗する。

## 現在の状態と残り

サイトと管理機能は稼働。確認用作品 `c1eedb30-6c85-4910-877c-ca94dfddbcb2` は非公開。4秒トーンと容量確認用WAVは運営用の下書きとして残しており、実作品の音源は公開していない。

実際の連絡窓口（contactUrl）は未設定。実スマートフォン、最大画像処理、多人数同時再生、実サーバーでの障害注入・復元訓練は未検証。DNS変更・有料契約・既存データ削除は行っていない。

HTML改変を抑止する設定の根拠: [Cloudflare Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/)。通常運用・バックアップ・非公開化・再試行は [operations.md](operations.md) を参照。

## PHPセキュリティ更新の再デプロイ

ユーザー依頼によりStore.phpとPublications.phpのみを更新。変更内容はscope単位の最新receipt保持・最大1024件の上限、公開切替に失敗したsnapshotの後始末、現在版以外で300秒より古いsnapshotの整理。依存関係・非公開設定・既存音源は変更していない。

旧PHP本体から非公開の新しい版を作り、変更2ファイルのSHA-256を照合した後、公開入口2ファイルの参照先を原子的に切り替えた。旧版と入口のバックアップは非公開領域に保持。期限付き・認証付き更新PHPは撤去済み。配布物をJSONで送るとホスト側403になったため、固定ハッシュを検証するgzip配布物で成功した。

現在の公開参照ファイルと設定の同一性、revision=3の保持、カタログ内容不変、公開API 200、署名なしbridge 401、署名付きstatus 200、非公開パス403/404を確認。再公開や本番データ整理は実行していない。公開時の新しい整理処理はローカル統合テストで確認。本番の静的UI・Workers・D1・DNSは再デプロイまたは変更していない。

この再デプロイのPHP構文検査、Musicの型・Lint・ビルド・統合23件、既存control-plane回帰85件が成功。証跡はGit除外済み `build/music-deploy/php-update/result.json` と `verification.json`。
