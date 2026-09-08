# PandD Command Code v1

実装開始: 2026-09-06。開始ブランチ `feature/koto/ImpMusicWeb`、commit `2883b1ca0dde3cd74af8bb01a20e85711ce7851d`。作業ブランチ `codex/music-command-code`。開始時に音量解析、GLSL背景、共有ボタン、配信スクリプトなどの未コミット変更があり、その内容を保持して機能を追加した。本番配信・実DB migration・DNS/SSL/GitHub App変更は実行していない。

## 利用方法

公開曲詳細で「共有」を押し、共有方法の一つとして「コマンドコード」を開く。同じ曲の同じ予約IDから常に同じ図形を生成する。PNG（1200/1600/2400px）、SVG、記号列、通常曲URLを保存・コピーできる。曲名などは画像外に置き、SVGへ利用者由来の文字列は埋め込まない。未発行の曲は共有メニュー内に「準備中」と表示し、閲覧・再生は従来どおり使える。

管理画面では担当曲の編集ページに「コマンドコード」欄を表示する。既存予約は自動で確認し、未発行なら「コマンドコードを発行」で予約する。閲覧だけでは発行せず、発行だけでは曲を公開しない。「曲名付きで印刷」は曲名・固定図形・記号列・公開URLだけを白背景で印刷し、編集フォームやメニューは印刷しない。ブラウザーの印刷ダイアログからPDF保存も選択できる。曲名は公開中なら公開版、未公開なら保存済み下書きを使う。

「作品の公開済み曲へコードだけ反映」は、その作品の公開済み曲に限定した既存backfillを実行する。編集中の下書き・非公開曲は公開しない。配布前に「公開ページで確認」から実際の公開状態を確認する。曲や親作品の非公開中、公開版へのコード反映前は、印刷したコードから曲を開けない。

メニュー「コードを読み取る」で `/scan` を開く。手入力、画像選択、カメラから選択する。画像はJPEG/PNG/WebPのみ、10MiB・20MP以下。画像ヘッダーから寸法を先に検査し、ブラウザーでEXIFの向きを反映して復号する。SVG/HEIC、手書き、任意フォント、一般OCRは対象外。画像・映像は送信・永続保存せず、CRC通過後の12文字だけをPHPへ送る。

手入力は↑↓→←ABXY、ASCII `UDRLABXY`、小文字を受け付ける。区切りは空白、改行、ハイフン、カンマのみ。不明文字はエラー。矢印キー・ABXYキー、1文字削除、全消去も使える。8記号からCRCを補完する機能はない。

カメラは本人の「カメラを起動」操作後だけ許可を要求する。背面・1280×720をidealで指定、マイクは要求しない。映像が鮮明になるよう四隅まで映す。停止、入力切替、離脱、非表示、読取成功で全trackを停止する。許可が遅れて返った場合も停止する。復帰しても自動再開しない。照会成功後は既存曲詳細へ一度だけ遷移し、再生・キュー・音量・ループを操作しない。

## 互換契約

`contracts/music/command-code-v1.ts` と `command-code-vectors.json` が固定仕様。IDは0～16777215、UUIDとは別の永久予約。値0～7は **U D R L A B X Y**（↑ ↓ → ← A B X Y）。ID8桁、CRC4桁を上位から8進数で並べ、先頭ゼロを保持する。

CRC-12/DECT: width=12、poly=0x80F、init=0、refin/refout=false、xorout=0。対象バイトは `50 44 4D 01 ID_HI ID_MID ID_LO`。ASCII `123456789` のチェックは `F5B`。CRCは認証・秘密・誤り訂正ではなく、完全な誤読防止も保証しない。

| ID hex | CRC hex | 正規コード |
|---|---|---|
| 000000 | 62F | UUUUUUUULUBY |
| 000001 | E20 | UUUUUUUDYUAU |
| 123456 | 846 | UAALRDRXADUX |
| FFFFFF | 7B1 | YYYYYYYYLXXD |

画像座標は800×480、白背景。外枠は(64,64)～(736,416)、線幅3。白余白は最低64（1セル）。6列×2行、セル中心x=200,280,360,440,520,600、y=200,280。セル64、図形56。フォントや絵文字でなく固定7×7の太い図形を8単位のSVGパスに変換する。描画とテンプレートは同一定義を共有する。

マーカー中心は左上(104,104)、右上(696,104)、右下(696,376)、左下(104,376)。各48×48、5×5の外周黒と内側3×3の固定形。内側は順に `100110001` / `110001011` / `111100010` / `101011100`。全25点・回転・四隅の相対位置・鏡像・枠と余白を検査する。曲のデータは12記号そのものにあり、マーカーや枠には隠さない。

これらは通常設定として変更しない。別配置・図形・CRCを導入する際はv2を別モジュール・別API経路で設け、配布済みv1デコーダーを維持する。

## 管理・保存・公開

追加DDLは `apps/admin-web/drizzle/0005_music_command_codes.sql`。既存DDL・ゲーム用テーブル・binding・認証は変更しない。`(version,code_id)` 主キーと `(version,track_id)` UNIQUEで競合を解決する。`crypto.getRandomValues` の3バイトを利用し、上限32候補。乱数Portは試験で差し替えられる。単一INSERT内で曲と現在権限を再検査し、`ON CONFLICT DO NOTHING` の後に同一曲の予約を読む。D1で非対応のBEGIN/COMMITを仮定しない。

予約は外部キー連鎖削除させず、DELETE/UPDATE禁止triggerを持つ。削除済み曲のコードを別の曲へ再利用すると、過去に印刷された画像が別曲を開くため、予約は永久に残す。DBバックアップ・復旧では必ずこのテーブルとtriggerも維持する。曲名・素材・順序の変更、停止・再公開でIDは不変。複製曲は新しいUUIDと予約を使う。

管理API:

- `GET /api/music/manage/tracks/:id/command-code`: 現在の担当権限で既存予約を確認し、未発行ならnullを返す。予約や公開内容を変更しない。
- `POST /api/music/manage/tracks/:id/command-code`、本文 `{}`: 既存Music認証・現在担当権限・Origin検査を通して予約を取得/発行する。この操作だけでは公開しない。
- 通常の作品/曲公開: 公開済み曲の予約を取得し、`commandCode:{version:1,codeId}` をDTOへ含めてから本文・digestを固定する。既存revision/receipt/retryをそのまま使う。
- `POST /api/music/manage/games/:id/command-codes`、本文 `{ "dryRun": true }`: 公開済み曲の対象一覧のみ。予約・公開更新なし。
- 同経路で `dryRun:false`: `commandCodes` だけを含む署名本文を作る。PHPはロック内で**現在公開snapshotのコード項目だけ**を追記し、下書き・公開済み本文をD1から上書きしない。現在版に対象曲がなければ409。他作品を同じsnapshotに保持し、索引を別世代へ分離しない。D1確定はdelivery/receipt/監査だけで、公開列や下書きを更新しない。

未知・非公開・削除・親作品停止は公開APIで同じ404。`GET/HEAD /api/public/command-codes/v1/:canonicalCode` はPHPでも形式・CRCを検査し、成功は `{ "trackId": "UUID" }`。不正400、STOPは503、他メソッド405・Allow:GET,HEAD、no-store。過去snapshotもD1も探索しない。公開閲覧・共有・認識でWorkers、D1、GitHub、外部認識APIへ通信しない。

## 適用順序（人が実施する作業・今回は未実行）

1. DBと現在snapshot・receiptをバックアップし、未確定の公開操作を既存の再照合手順で解決する。
2. ステージングでPHPの `CommandCodes.php`、bootstrap、Publications、api.phpを先に配置し、新項目とコード専用公開を受信できる状態にする。private領域はdocument root外。旧snapshotは項目欠如のまま閲覧可能。
3. 既存control-planeの対象DBを人が確認し、既存migration手順で **0005** を追加適用する。旧0004は書き換えない。本番コマンド実行は担当者が行う。
4. 管理側を更新してから公開フロントと `.htaccess` を配置する。`package:rental` は配布物の準備のみで本番転送しない。既存 `deploy` は今回は使用しない。
5. 以下のdry-runで一覧を確認し、確認した計画だけを適用する。通常の「公開」ボタンを一括移行の代用にしない。
6. 公開PHP経由で読取、停止→404、再公開→同じID、/scan再読込、Workers停止中の動作を確認する。

```sh
# Cookie値は環境変数MUSIC_ADMIN_COOKIEに安全に設定し、シェル履歴や計画へ書かない。
node apps/music/scripts/command-code-backfill.mjs --origin https://CONTROL_PLANE_ORIGIN --output reviewed-plan.json
# 必要なら --game UUID で対象作品を限定する。計画は曲ID・公開曲名だけ。
# 人が計画を確認した後:
node apps/music/scripts/command-code-backfill.mjs --origin https://CONTROL_PLANE_ORIGIN --apply reviewed-plan.json
```

計画作成は冪等なdry-run。適用前に対象一覧を再取得して変更があれば止める。途中失敗時は管理の「公開処理」で元操作を再照合してから同じ計画を再実行できる。予約IDは変えない。再実行では新しい公開revisionを記録する場合があるが、コードと公開本文は変えない。

切戻し時も予約テーブル・履歴を削除しない。配布済みコードがあるため、コード読取対応PHPを旧版へ戻すと機能停止になる。旧管理側は公開更新時にcode項目を落とすため、管理の公開書込を停止してから切戻し、対応版復旧後にコード専用反映を行う。古いsnapshotへの自動復帰はしない。

## 認識・依存・配信設定

追加npm依存なし。既存のReact/React Router/ブラウザーCanvas/Playwright/esbuildを利用。v1図形・認識器は第一者コードで、本機能が追加する第三者ライセンス表記はない。既存依存のライセンス表記は保持する。既存に画像認識ライブラリがなく、固定図形だけに対象を絞れるため、連結成分→凸包四隅→8係数射影→固定テンプレートという小さい実装を採用した。汎用OCR、CDN、WASM、Web Worker、SharedArrayBufferは追加していない。

手入力・ホーム・曲詳細は認識器をロードしない。画像/カメラ操作時にdynamic import。最終ビルドの遅延chunkは認識器約4.38kB（gzip2.08）、カメラ約1.59kB（gzip0.83）、画像復号/出力約2.63kB（gzip1.34）。画像出力chunkだけはPNG/SVG保存時にも取得する。認識開始時の追加最大は合計約8.60kB（gzip4.25、HTTPヘッダー除く）。公開メインJS全体は337.18kB（gzip107.96）、CSS20.74kB（gzip5.54）。gzip値はビルド時の圧縮サイズで、実HTTP圧縮は配信設定に依存する。

`src/config/command-runtime.defaults.ts` に200ms間隔、3回連続一致、最大辺1400px、確信度0.87・次点差0.075、容量/画素上限、照会8秒、PNG既定幅を集約。v1定義とは区別する。低確信度候補からCRC総当たりで答えを作らない。複数マーカー集合があれば1コードへ絞る案内を出す。

本番HTMLへのCSPは `server/music/public/.htaccess`。PHP APIの共通CSPはJSON/media用で、HTML用とは別。既存 `script-src 'self'` を維持し、unsafe-eval/wasm-unsafe-eval/worker-srcは不要。`img-src` のdata/blobでローカルSVG/画像を表示する。`.htaccess` に `Permissions-Policy: camera=(self), microphone=()` と /scan のSPAルートを追加。APIエラーやprivate禁止ルートはSPAへ送らない。

HTTPS・実際のApache Header/Rewrite有効化・複数CSPヘッダー・レンタルサーバー独自ヘッダーは本番実測前。ローカルPHP router試験をApache設定の実測とは扱わない。サブディレクトリでは `MUSIC_BASE_PATH=/music/` でフロントをビルドし、PHP `basePath=/music` に一致させる。DNS/SSL設定の変更は担当者作業。

## 自動試験・実測

生成器: `tests/integration/command-images.test.ts`。SVGをChromiumでラスタライズし、画像の画素だけを認識器へ渡す。正解IDはテストの外側で比較し、ファイル名・metadataは認識器へ渡さない。

調整seed `0x69cae541`、最終評価seed `0xbaf30726`。それぞれ基礎100、軽度500、拒否40。最終評価結果 **基礎100/100、軽度493/500（98.6%）、拒否対象の誤受理0/40**。調整セットは100/100、496/500、誤受理0/40。評価画像に合わせた個別コード分岐はない。全ケースのID・期待値・条件・失敗理由・処理時間は `apps/music/build/command-code/image-results-baf30726.json` に再生成される。

入力Canvasは1000×750。基礎は正面、倍率0.375（セル24px）を含む0.5～1.15倍。軽度は0.65～1.05倍を基準に、回転±20度、四隅各±16px、縮小、JPEG品質0.8、明るさ0.65～1.30倍、blur 0.6px、灰青背景を分けて評価。射影例は800×550相当の領域へ配置。拒否はコードなし、図形だけ、マーカー欠け、セル欠け、blur9px、CRC不正、鏡像、複数コード。強い組合せ劣化・反射・湾曲・実紙写真全般はこの合成評価の対象外。

最終評価の未読7例はいずれも明るさ変化でマーカーを検出できなかった。誤った有効コードとして受理した例は0。これはこの有限セットの結果であり、現実の誤読ゼロを保証しない。

さらに固定4ベクター×0/90/180/270度の16例が全件一致。最終check内の640例の認識処理単体の中央値14.2ms、95パーセンタイル26.6ms、最大45.6ms（このWindows上のChromium）。画像復号・ネットワーク・カメラの焦点調整時間は含めず、実機の性能値としては扱わない。遅いフレームの後に次の処理を予約するため、処理待ちフレームは蓄積しない。

```sh
npm --prefix apps/music run check
npm --prefix apps/music run test:e2e
npm --prefix apps/music run test:public
npm --prefix apps/music run package:rental
# 画像セットだけ再生成する場合（apps/music内）:
node --import tsx --test tests/integration/command-images.test.ts
# 調整セット: COMMAND_IMAGE_CALIBRATION=true を環境変数に設定して同コマンド
```

試験ログと最終実行結果はこの文書末尾に記録する。Windows環境のユーザーnpmラッパー参照先に不備があり、検証は `C:\Program Files\nodejs\npm.cmd` を明示。既存build/node_modules書込に必要な権限を得て、ローカル限定で実行した。

## 実機確認表（未実施）

**iPhone Safari・Android Chromeとも実機未検証。** WebKit自動試験はiPhone実機の代替結果ではない。合成MediaStreamのカメラ自動試験はChromium限定で、画像認識自体はChromium/Firefox/WebKitのUIから検証する。

担当者は各OS/ブラウザー版を記録し、紙と別画面の両方を読む。コード横幅（cm/px）、距離cm、水平/垂直角度、照度または照明条件、読取秒数、成功/未読/誤受理を分けて記録する。正面・明所から始め、最小サイズ・斜角・暗所・反射を段階的に試す。

許可拒否、許可保留中キャンセル、前後カメラのみの端末、別アプリ使用中、停止、ページ移動、タブ非表示、画面ロック、戻る、連打、画像選択切替を確認し、OSカメラインジケーターが消えることを確認する。実機のEXIF付きJPEG/WebP・不正/巨大画像も確認する。音楽再生中にスキャンし、既存キュー・音量・シーク・通常リピート・区間ループが保たれることを確認する。

## 最終実行記録

共有メニューへの統合・管理画面の確認/印刷の追加後、`command-manager.spec.ts` で既存コード取得、再読み込み後の一致、印刷要求、印刷時のフォーム非表示、公開済み曲へのコード専用反映、未公開曲への発行と非公開状態維持が3ブラウザーとも成功した。印刷要求はOSダイアログ境界で捕捉し、印刷用CSSを適用した実画面を撮影した。実プリンターへの出力・OSのPDF保存操作は未実施。

追加変更の最終結果: `check` は型・lint・build・単体/統合42件すべて成功（`build/command-manager-check-confirmed.log`）。管理E2Eは3件成功（`build/command-manager-e2e-confirmed.log`）。共有メニュー変更の関連E2Eは7件成功・合成カメラ2件skip（`build/command-manager-e2e.log`、同実行内の旧管理試験は後述の試験不備で失敗し、上記で再成功）。管理側TypeScriptも成功。全E2E53件の記録は下表の初版時点の結果で、今回は関連シナリオを再実行した。

最新配布物は `apps/music/build/rental-package-fWXQFj`（`build/command-manager-package.log`）。公開メインJSは337.18kB/gzip107.96kB、CSSは21.55kB/gzip5.71kB。管理画面は `build/command-code/manager-chromium.png`、印刷見本は `manager-print-chromium.png`（Firefox/WebKit版も生成）。試験のPHP・workerdは終了済み。本番への転送・DB適用はしていない。

追加試験の初回は印刷で非表示にしたフォームを可視要素として再検索して時間切れになり、印刷前の画像と比較するよう修正した。次の実行では、存在しないDELETE APIを試験の後片付けで呼んで405になったため削除した。試験曲は実行ごとの隔離DBにだけ作成し、公開しない。統合試験とE2E環境の並行起動でも時間切れが発生したため、最終確認は起動を重ねずに行う。サブディレクトリ単独再試験は成功した。

| 実行 | 最終結果 |
|---|---|
| `npm --prefix apps/music run check` | 型・lint・アーキテクチャ・公開build成功、単体/統合42件成功、失敗0。追加subdirectory試験・通信失敗時の日本語表示試験も含む |
| `node --import tsx --test tests/integration/command-images.test.ts` | 100/100、493/500、誤受理0（全640例）、固定ベクター回転16/16。厳密化した誤受理assertでも再成功 |
| `node --import tsx --test tests/integration/command-subdirectory.test.ts` | 追加1件成功。実 `/music/` 用Vite build、PHP、.htaccess由来CSPヘッダー、/scan直開き・再読込・手入力照会・曲詳細・共有図形を実Chromiumで確認 |
| `npm --prefix apps/music run test:e2e` | 53成功・7skip・失敗0（Chromium20、Firefox19、Windows WebKit14成功） |
| 新機能のE2E内訳 | 共有/保存/コピー/表示サイズ/画像/手入力/異常系は3ブラウザー成功、合成実画素カメラはChromium成功。Firefox/WebKit合成カメラは2skip |
| `npm --prefix apps/music run test:public` | 管理workerdを停止後にPHPだけで再生・手入力・画像読取成功。GET28件、外部origin試行0、画像送信用POSTなし、ページ例外0 |
| admin-web `tsc --noEmit --incremental false` | 管理側全体の型検査成功 |
| PHP `-l` | 第一者17ファイル成功（test routerの追加subdirectory分は専用試験でも実行） |
| `npm --prefix apps/music run package:rental` | `apps/music/build/rental-package-lcIT9o` に最終生成、CommandCodes.php・/scan rewrite・Permissions-Policy収録確認。本番転送なし |

7skipの残り5件はWindows WebKitにないWeb Audio/OfflineAudio関連。実機合格として数えていない。全件E2Eの初回は背景編集の45秒タイムアウトと、その未回収作品による件数違い、未搭載音量解析APIの通知期待値で失敗した。管理操作が多い試験の上限を90秒にし、音源登録と任意の音量解析をテスト上で区別して再実行した。製品の音量解析コードや録音権限は変更していない。

サブディレクトリ追加試験の初回はテストサーバーの起動確認URLがルート固定のため失敗した。basePathを尊重するよう修正し、失敗時にも起動したPHPを停止する後片付けを追加して成功。既に残った隔離試験PHPもコマンドラインで対象を識別して停止した。最終の8088/8788待受はなく、試験のPHP・workerd・ブラウザーは各所有元で終了した。

ログ: `apps/music/build/command-check-final.log`、`command-images-final.log`、`command-subdirectory-final.log`、`command-e2e-final.log`、`command-public-final.log`、`command-package-final.log`。画像見本は `build/command-code/sample-v1-123456.png` / `.svg`、画面は `build/command-code/share-chromium.png`（Firefox/WebKit版も生成）。

**実装済み**: 発行・永久予約・署名同期・コード専用一括反映・PHP照会・共有/保存/コピー・実画素認識・カメラ・手入力・既存曲詳細遷移・運用手順。

**自動確認済み**: 上表の範囲。クリップボードはAPI境界で内容を捕捉し、OSの共有クリップボードは変更していない。カメラの実画素動画は合成MediaStreamで、実機映像ではない。

**実機確認済み**: なし。**未検証**: iPhone/Androidの紙・画面撮影、実OSの権限/カメラインジケーター、強い複合劣化、実機EXIF画像、レンタルホストのApache/HTTPS/DNS/実ヘッダー・本番負荷・本番DB適用。操作手順は上記の実機確認表・適用順序を使用する。

## 参照した一次資料

[D1 prepare/batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)、[getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)、[CRC-12/DECT catalogue](https://reveng.sourceforge.io/crc-catalogue/1-15.htm#crc.cat.crc-12-dect)。v1の図形・配置・閾値は本実装の仕様であり、これら外部資料の標準形式ではない。
