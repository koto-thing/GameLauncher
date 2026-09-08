# 曲ごとの音量補正

## 動作

- 新規音源はアップロード後に管理ブラウザーで全曲を測定する。
- 既存曲は曲編集画面の「音量を測定する」で登録済み音源を取得して測定する。再アップロードは不要。
- 測定後に「下書きを保存」、公開中の曲は「更新を反映する」を実行する。保存だけでは公開版の音量は変わらない。
- 測定値は音源IDと共に曲の下書き・公開JSONに保存する。音源差し替え時は測定値を外し、新しい音源を測定する。
- 測定未設定の曲は原音量で再生する。無音・短い音源などの測定不能は画面で明示し、増幅しない。解析失敗はエラー表示し、登録した音源を再測定できる。

曲全体のIntegrated LUFSから固定ゲインを計算する。目標は **−18 LUFS**、測定したTrue Peakの上限は **−1 dBTP**、最大増幅は **+12 dB**。これらはMusicの製品設定であり規格上の必須値ではない。

`gainDb = min(-18 - integratedLufs, -1 - truePeakDbtp, 12)`

曲内の強弱を保つためAGCや動的リミッターは使用しない。ピーク余裕の小さい曲では目標音量に届かないことがある。測定値に基づくピーク制限であり、別のデコーダー・リサンプラーや不連続なループ境界を含む出力のTrue Peakを保証するものではない。

通常再生のMediaElementAudioSourceNodeと区間ループのAudioBufferSourceNodeを同じGainNodeへ接続する。一般聴取では解析も全曲ダウンロードも追加しない。補正済み曲の再生にはWeb Audioが必要。

管理画面の解析は48 kHz、mono/stereo、最大600秒・展開PCM 256 MiB。WASMもPCMも管理ブラウザー内で処理する。通信先は既存の認可済み音源APIだけ。デコード後にも実サイズを検査し、同時解析は1曲、画面を離れたら結果を破棄する。端末全体の消費メモリには圧縮データ・デコーダーの作業領域も加わる。

## 管理画面のCSP

`apps/admin-web/proxy.ts` から現在のパスをCSP生成へ渡し、`apps/admin-web/lib/csp.ts` でパスが `/music` の場合だけWASM実行を許可する。

対象のscript-srcは `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`。JavaScriptの `unsafe-eval` は追加しない。他の管理ページ・公開サイトのCSPは変えない。これは管理画面でWASMをコンパイル・実行できる範囲を追加する変更。

ユーザー承認後に設定変更を適用済み。本番CSPをHTTPヘッダーとして強制したChromium・Firefoxで、実音源のデコードとLoudnessMeterによる全曲測定を確認した。他ページでは同じ測定モジュールのWASM実行が拒否されることも検証済み。コード変更のみで、本番へのデプロイは行っていない。

生成物と再ビルド手順は `packages/music-loudness/README.md` を参照。

## 検証結果

- 型検査、変更したソースのESLint、公開build、管理build：成功。管理buildには依存ライセンスも同梱。
- 単体テスト11件：成功。実WASMで20 dB差の音源の補正後LUFS、ステレオ加算、端数ブロック、無音、短い音源、ピーク制限、測定値の検証を含む。
- 音量保存・公開の統合テスト1件：単独実行で正常終了。実D1の下書きからPHP公開snapshotまで確認。
- Chromium・Firefoxの関連E2E計6件：成功。既存音源の測定・保存・再読込・試聴、新規音源のアップロード・自動測定・公開、通常/ループ再生の実振幅と曲切替を確認。
- Chromiumの既存音声競合・非対応APIテスト計3件も成功。
- 全体 `npm test` は既存の公開・権限テストの各検証を通過した後、終了処理で停止したため中断。全体成功とは扱っていない。
- 全体 `npm run lint` は別変更の `scripts/deploy.mjs` にある `@brief` 未記述で停止。音量補正の変更ソースのESLintは単独で成功。
- CSP単体テスト4件と、本番CSPを強制したChromium・Firefoxの実解析テスト2件：成功。再実行は `apps/admin-web` で `node --test tests/proxy-csp.test.mjs`、`apps/music` で `node --import tsx --test tests/e2e/loudness-csp.node.mjs`。
- CSP変更時の変更ファイルのESLintは成功。全体型検査の再実行では別変更のWebGL背景（`game-design.tsx`、`webgl-background.tsx`）とモデルの型不一致を検出した。CSP変更に由来するエラーはない。
- 実Safariでの測定・再生は未検証。
