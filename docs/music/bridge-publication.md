# Bridge v1・公開同期

## 転送

管理先は設定で固定したHTTPSの`/bridge.php`。redirectは追従しない。例外は明示local環境のloopback HTTPだけ。Cookie、GitHub利用者token、ゲーム用資格情報は転送しない。通常聴取はbridgeへ接続しない。

`X-Music-Envelope`はUTF-8 JSONのbase64url（paddingなし）。`X-Music-Signature`は次のUTF-8文字列のHMAC-SHA256、小文字hex。

```text
PandD-Music-v1\n{X-Music-Envelopeの文字列}
```

改行は実際のLF1文字。JSON再serializeの差を避け、送ったbase64url文字列そのものへ署名する。契約は`contracts/music/bridge-v1.ts`。フィールドはprotocolVersion、keyId、audience、environment、method、path、issuedAt、expiresAt、nonce、operationId、actorId、gameId、assetId、action、expectedRevision、payloadDigest、bytes、kind、mime。UUIDはサーバー生成v4、利用者はGitHub数値ID、広告scopeだけ`ads`。

署名有効期限120秒、未来時刻の許容5秒、nonceは原子的に消費し180秒超の記録を整理する。本文digestはraw bytesのSHA-256。uploadはraw body、publishは固定JSON、status/previewは空本文digest。鍵はMusic専用・環境ごとに分離。PHPのkeysへ新keyIdを加え、Workerを新keyIdへ更新し、転送中要求の期限後に旧鍵を失効する。

## 管理API

| action | 動作 |
|---|---|
| upload | D1で先に発行したupload/asset ID、所属、形式、容量、digestを拘束。PHPでstream受信、実体検証、私有保存。同一IDは同一内容だけ再試行可 |
| preview | 対象所属の素材を管理API経由でstream返却。署名URLを公開サイトへ返さない |
| publish | 不変作品公開DTOまたは広告を期待scope版に適用 |
| status | 元operation ID＋scope＋digest＋期待版に一致したreceiptだけ返す |

uploadは64KiBずつPHPへ書き込み、Workerで音声全体のデコードやmultipart全量保持をしない。PHPはfinfo・GD・getID3で検証。JPEG/PNG/WebP、MP3/PCM WAV、容量・長さ・画像寸法・チャンネル数を検証する。元ファイル名をパスに使わずUUIDを使い、検証済み実情報とdigestをD1で照合する。進捗・失敗・同一upload IDの再送は管理UIから行える。

## 公開状態

```text
prepared → sending → applied
             ├→ failed（確定した拒否）
             └→ unknown（通信/receipt/D1確定が不明）
failed/unknown → 同じ操作IDのstatus → 必要な場合だけ同じ本文を再送
```

未確定のprepared/sending/unknownがある作品には次の公開操作を作れない。編集中のdraftは保存可能。PHP receipt確認後にD1の公開列だけをbatch更新するため、途中で保存されたdraftを上書きしない。画面の「公開処理」で結果不明・取り下げ未反映の可能性を表示し、「状態確認・再試行」で復旧する。自動の人間承認やゲーム承認待ちは追加していない。

PHPは安定publication.lockの排他下で最新snapshotを読み、対象scopeだけ変更する。別作品・広告の更新を落とさない。同じscopeはexpectedRevisionで競合拒否。完成snapshotを同じfilesystemに保存し、current.jsonをatomic renameで切り替える。receipt ledgerも同じsnapshotに含めるので、切替直後の応答消失でも次のstatusで判定できる。未切替snapshotの存在だけでは成功扱いにしない。ledgerはscopeごとの最新結果だけを保持し、全体を1024件に制限する。切替後は実行時間上限を越えて5分経過した現在版以外のsnapshotを削除し、開始済みの読取と段階デプロイを妨げない。

下書き・旧版・原本・バックアップはdocument root外。現在参照が失われたり壊れたりした場合は503で閉じ、過去snapshotに自動で戻さない。古い公開操作を遅延再送してもscope版の不一致で取り下げ後に復活しない。

## 公開配信・取り下げ

`/api/public/catalogue`、`/api/public/ad`、`/api/public/config`、`/api/assets/:uuid`はローカルsnapshotだけを読む。公開許可を先に確認し、GET/HEAD/Range/条件付き要求にも同じ判定を適用。初期版はno-store。Service Worker、共有CDN media cache、公開原本URLは使わない。

Rangeはsingle byte range、suffix、open-ended、206/416に対応。複数rangeは416、HEADのRangeは無視して全体のヘッダーだけを返す。長い音源送信中に公開更新lockやPHP session lockを持たない。取り下げ後の新規要求は404。配信開始済みのHTTP応答、取得済みAudioBuffer、利用者が保存したデータは回収できない。

エラーは入力400、署名401/403、対象404、競合409、容量413、回数429、設定/外部不明503等。内部保存パス・秘密を応答に出さない。PHP filesystemとWebサーバーの実動作は本番配置前に再検証する。

確認に使った一次資料：[GitHub PKCE](https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/)、[Workers Streams](https://developers.cloudflare.com/workers/runtime-apis/streams/)、[PHP flock](https://www.php.net/manual/en/function.flock.php)、[PHP hash_equals](https://www.php.net/manual/en/function.hash-equals.php)。
