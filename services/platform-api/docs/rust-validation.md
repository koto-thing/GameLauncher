# Rust/Wasm 検証処理

`POST /v1/play-sessions` のスキーマ適合後のバッチ全体を
`rust-validation/src/batch.rs` の Rust 関数で検証する
許可ゲーム・環境・UUID の重複・セッション時刻・終了状態・日別配分の上限と合計を検証し、
UUID と UTC 時刻を正規化する
`src/rust-validation.ts` が静的 Wasm モジュールを isolate ごとに一度だけ初期化し、
`src/validation.ts` がスキーマ検証後、D1 保存前にバッチを一度だけ渡す
判定に失敗した場合の既存の 400 応答とエラーメッセージを維持する

正規の JSON Schema 検証は既存の生成済み Ajv を入口に残して解釈差を避ける
Rust はその型と件数の制約に適合したバッチを Serde で読み込み、意味検証を担う
スキーマ違反を意味検証より先に返し、セッションごとのエラー順序も維持する
Rust の全検証ロジックと重複する本番 TypeScript 実装は残さない
移行前実装は差分テスト専用の fixture として固定し、本番から参照しない

ストリーミングの 1 MiB 制限、認証、rate limit、D1、キャッシュ、集計、削除、
scheduled retention は既存実装を使う
R2 binding はこのサービスに存在しない
ホスト、課金プラン、DB スキーマ、secret、binding の変更は不要

## ビルドと検証

Node 24 以上、リポジトリ指定の Rust toolchain、`wasm32-unknown-unknown` が必要
Serde / serde_json で JSON を受け渡し、Chrono で UTC 時刻を解析する
wasm-bindgen が文字列のメモリ管理を生成するため独自のポインタ操作や unsafe FFI は不要
wasm-bindgen crate と CLI のバージョンを `0.2.129` に揃える
wasm-pack は不要

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
npm ci --prefix services/platform-api
npm run check --prefix services/platform-api
```

`npm run rust:build --prefix services/platform-api` が Rust をビルドし、
`src/generated/rust/` に Wasm と標準の JS バインディングを生成する
CLI の別配置を使う場合は `WASM_BINDGEN` に実行ファイルのパスを指定する
生成物はコミットせず、dev、typecheck、test、deploy の既存の前処理で再生成する
`npm run rust:test --prefix services/platform-api` で Rust 単体テストを実行する
Node 契約テストは専用 import hook で同じ Wasm を読み込む
本番コードは Wrangler の静的 Wasm import を使い、動的コンパイルを行わない

境界値と固定 seed の変異テストは従来の JavaScript 判定とエラーと正規化結果の一致を検証する
ECMAScript の trim と Rust の空白集合の差、および JavaScript が拒否する閏秒も確認する
workerd テストは生成済み Worker と Wasm を読み込み、拒否時にローカル D1 が空であること、
正常な取り込み、再送、集計取得、削除が動作することを確認する
一 MiB ちょうどの受理とストリーミング中の超過拒否も確認する
テストはローカル D1 を使用し、本番へのイベント送信や SQL 実行を必要としない

最大件数の百セッションと各九十一日配分でも移行前の結果との一致を検証する
STORM-PC の参考測定ではこの正常入力の検証中央値が移行前約 14.75 ms、Rust 版約 7.76 ms
この値はローカル Node 上での測定であり、本番の CPU 時間や上限の保証には使わない
既存の無料プランと binding を維持し、本番向け bundle は約 280 KiB に収まる

## 統合とリリース

共有 CI の analytics job は `npm run check` 前に Rust toolchain と Wasm target を
用意し、同じバージョンの wasm-bindgen CLI をインストールする必要がある
共有ファイルの更新は統合担当が行う
Rust を用意しないビルド環境では生成に失敗するため、リリース前に確認する

承認後も既存の Workers と既存の D1・rate-limit binding を使ってリリースする
追加の DB migration は不要
ロールバックは以前の Worker version を再配信するか、この変更を revert して
従来のデプロイ手順を実行する
データ形式は変わらないため DB の巻き戻しは不要
