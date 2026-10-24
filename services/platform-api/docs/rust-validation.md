# Rust/Wasm 検証処理

`POST /v1/play-sessions` のセッション時刻、終了状態、日別配分の上限を
`rust-validation` の Rust 関数で検証する
`src/validation.ts` が静的 Wasm モジュールを isolate ごとに一度だけ初期化し、
スキーマ検証後、D1 保存前に必ず呼び出す
判定に失敗した場合の既存の 400 応答とエラーメッセージを維持する

JSON スキーマ、ゲーム・環境・重複の検証、日別配分の合計、正規化、
ストリーミングの 1 MiB 制限、認証、rate limit、D1、キャッシュ、集計、削除、
scheduled retention は既存実装を使う
R2 binding はこのサービスに存在しない
ホスト、課金プラン、DB スキーマ、secret、binding の変更は不要

## ビルドと検証

Node 24 以上、リポジトリ指定の Rust toolchain、`wasm32-unknown-unknown` が必要
外部の Rust crate、wasm-pack、wasm-bindgen は不要

```sh
rustup target add wasm32-unknown-unknown
npm ci --prefix services/platform-api
npm run check --prefix services/platform-api
```

`npm run rust:build --prefix services/platform-api` が Rust をビルドし、
生成した Wasm を `src/generated/analytics-validation.wasm` にコピーする
生成物はコミットせず、dev、typecheck、test、deploy の既存の前処理で再生成する
`npm run rust:test --prefix services/platform-api` で Rust 単体テストを実行する
Node 契約テストは専用 import hook で同じ Wasm を読み込む
本番コードは Wrangler の静的 Wasm import を使い、動的コンパイルを行わない

境界値の比較テストは従来の JavaScript 判定との一致を検証する
workerd テストは生成済み Worker と Wasm を読み込み、拒否時にローカル D1 が空であること、
正常な取り込み、再送、集計取得、削除が動作することを確認する
テストはローカル D1 を使用し、本番へのイベント送信や SQL 実行を必要としない

## 統合とリリース

共有 CI の analytics job は `npm run check` 前に Rust toolchain と Wasm target を
用意する必要がある
共有ファイルの更新は統合担当が行う
Rust を用意しないビルド環境では生成に失敗するため、リリース前に確認する

承認後も既存の Workers と既存の D1・rate-limit binding を使ってリリースする
追加の DB migration は不要
ロールバックは以前の Worker version を再配信するか、この変更を revert して
従来のデプロイ手順を実行する
データ形式は変わらないため DB の巻き戻しは不要
