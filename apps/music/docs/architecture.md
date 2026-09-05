# 設計

## 独立した境界

開始時にワークスペースの `agents.md`、README、既存admin-web/docs-workerの依存・実行方法と未コミット変更を確認。ユーザー指定により `apps/music` に独立実装しました。既存Docs編集の変更を上書きしていません。GameLauncherの認証、ゲーム公開承認、API、DBへ依存しません。

```text
Presentation → Application → Domain
Infrastructure → Application ports / Domain
Composition → 全層を生成して接続
```

- Domain：作品・曲・素材・ループ・クレジット・権限、入力・公開のルール、再生位置とキューの純粋関数。React/SQL/Worker/Web Audio/環境変数に依存しません。
- Application：MusicService、AuthService、Player。Repository、AssetStorage、IdentityProvider、AuthStore、AudioEngine、Clock、IdSource、TokenPortを注入します。
- Infrastructure：D1のパラメーター化SQL、R2ストリームと検証、GitHub OAuth、Web AudioとHTML音声。
- Presentation：HonoのHTTP変換とレスポンス、Reactの入力・表示。クライアント側検証に加え、APIもApplicationを通して再検証します。
- Composition：clientは音声エンジンを1個だけ生成。serverはリクエストのBindingsから具象を生成。サーバーSecretのクライアントimportは禁止します。

## 永続化・公開

`games` と `tracks` は `draft` と `published` JSONを持ちます。ループ・音源ID・代表画像ID・クレジットは同じスナップショットに含まれます。`version` を条件に単一SQL UPDATEし、成功時にversionを増やします。曲順も `published_position` で保存途中の変更を隠します。競合・権限の途中変更は409です。監査履歴はDBトリガーまたは同一D1 batchで変更とともに記録します。

公開操作は担当者または運営が実行できます。作品新規作成・担当割当・運営ロール・広告・緊急停止は運営だけです。運営による `suspended` は担当者の公開操作では解除できません。ロールはセッションに固定せず毎回accounts/membershipsから読みます。書き込みSQLでも最新権限を条件にするため、チェック後の担当解除も書き込み成功にしません。

素材は作品所属を持ち、同じ作品の検証済み・適切な用途のIDだけを参照できます。Asset IDとR2 keyは別々のサーバー生成UUIDで不変です。公開APIは構築したDTOだけを返し、内部キー・下書き・セッション・内部アカウントを含めません。

## 素材の登録と配信

認可 → pending DB行 → FixedLengthStreamでR2保存 → 形式・容量・メタデータ検証 → verifiedへ確定。再送は別IDです。本文再書込APIはなく、検証後の本文差し替えを許しません。R2とD1を単一トランザクションとは扱いません。失敗時はR2回収を試み、pending行から後日整理できます。

音源はmusic-metadataでストリーム解析。画像はfile-typeでJPEG/PNG/WebPに限定し、上限内で構造・image-dimensionsによる寸法を確認します。自動トランスコード、画像の向き補正・リサイズ、ウイルススキャン、音声波形の品質保証は行いません。画像の構造検査は完全な画像デコードの代わりではありません。

`/api/assets/:id` は**本文取得より先に**公開参照または現在の作品権限を確認します。作品画像・公開曲の音源/代表画像・有効広告を参照判定に含めます。共有Assetは有効な公開参照が残る間は配信されます。過去のIDを知っていても現在の公開参照がなければ匿名404です。初期版はno-storeを採用し、状態確認を迂回する共有キャッシュを設けません。

200、HEAD、単一Rangeの206、無効/複数Rangeの416を扱います。複数Rangeはmultipart配信をせず明示的に拒否します。転送済みデータの回収やコピー防止は保証しません。

## 認証

GitHub OAuth App、最小スコープ、固定callback、短命stateとPKCE S256。stateはHttpOnly Cookieと比較し、DBからDELETE RETURNINGで一度だけ消費します。アクセストークンはその場の `/user` 呼び出しだけで使用し永続化しません。外部応答は容量・時間を制限し、リダイレクトに認証情報を追従させません。

セッションはランダム256bit、DBはSHA-256のみ保存。CookieはHttpOnly/SameSite=Lax、本番HTTPSではSecure。Origin+CSRFを全変更APIに要求し、回数制限もD1で原子的に更新します。任意のGitHubアカウントには所属・運営権限を付与しません。初期運営は数値ID許可リストによる初回登録のみです。

## プレーヤー

1つのBrowserAudioをReact Routerの外で作り、再生キューとモードはPlayerが保持します。通常再生はHTMLAudioElement。区間ループ有効化時だけ取得・デコードし、AudioBufferSourceNodeのレンダリング処理で反復します。表示タイマーは再生位置の変更を行いません。

位置は `offset + (AudioContext.currentTime - startedAt)` をDomainで正規化します。イントロは1回、終了後は開始〜終了の余りで求めます。一時停止・シークは新しいNodeを作ります。ループ解除はNode.loopをfalseにし、現在の波形位置からアウトロへ進みます。手動前後移動では曲固有の区間設定を解除します。

generationとAbortControllerで古い結果を無効化します。デコードは1ジョブ、保持PCMは1曲、前曲のNodeとBufferを解放します。受信済み圧縮データ・デコード作業領域のピークは96MiB予算の外であり、物理端末で測定が必要です。ブラウザーやOSの中断を独立状態として表示し、ユーザー操作で再開します。

参考：[Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)、[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[AudioBufferSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)。
