# 調整値

| 場所 | 初期値・単位 | 変更時 |
|---|---|---|
| `contracts/music/policy.json` | audio64MiB、image8MiB、音源600秒、画像最大辺4096px、最小loop0.1秒、文字列上限 | `npm run policy:sync`でPHP設定へ同期し、管理・公開を再build、PHPを再配置。buildで一致検査 |
| `apps/admin-web/music/config/settings.ts` | 管理JSON1MiB、upload20/人/分、mutation120/人/分、bridge timeout120,000ms、署名120秒 | 管理再build。署名/JSONのPHP側制約も一致させる |
| `server/music/src/Signature.php` | 署名120秒、未来許容5秒、nonce保持180秒、envelope8192文字 | PHP配置。署名期限変更時はWorker設定も変更 |
| `server/music/scripts/cleanup.php` | 一時素材24時間 | 整理スクリプト配置。原本/参照は対象にしない |
| `apps/music/src/config/player-runtime.defaults.ts` | PCM96MiB、decode48kHz、同時decode1、試聴前置3秒、次曲音源prefetch OFF、表示更新200ms | 公開・管理再build |
| `apps/music/src/config/manager-runtime.defaults.ts` | upload timeout180,000ms | 管理再build。失敗後は同じファイルを選んで元upload IDで再試行 |
| `apps/music/src/config/design-tokens.css` | 配色、余白、スマホ操作領域、ライト/ダーク | 公開・管理再build |
| `apps/music/src/config/game-design.defaults.ts` | 背景色#fff4f6、画像なし、cover | 新規カスタマイズの初期値、再build |
| `apps/music/src/config/carousel.defaults.ts` | 画像切替5000ms | 再build。音声loop時計とは無関係 |
| `apps/admin-web/lib/auth.ts` | session8時間、OAuth10分、ゲーム再認証15分 | 共通認証の変更として回帰テスト |
| D1管理入力 | loop開始/終了秒、曲順、画像、クレジット、コメント、作品デザイン | 下書き保存後の公開反映で一般サイトに反映 |
| PHP config/local.php、Worker Secrets | 接続先、環境、専用鍵、contactUrl | 非公開設定として環境別に管理 |

秒の小数を保存時に丸めない。PCM見積りは音源長×decode sample rate×channels×4。96MiBはエンジンの予算であり、端末全体の安全メモリ量を保証しない。音源変更時は旧loopを解除し、保存後に再設定する。

上限変更は既存レコードを自動書換えしない。次回編集・公開時の検証へ適用される。実際のHTTP上限・PHP memory_limit・Webサーバーtimeoutは外部環境の設定であり、このJSONだけでは変更されない。

テーマは各originのlocalStorage `pandd-music.theme`へ保存。管理サイトと公開サイトが別originの場合、手動選択は共有しない。未設定時はOS配色。背景画像は同作品の検証済み素材だけを利用し、任意HTML/CSS/JavaScript入力を許さない。
