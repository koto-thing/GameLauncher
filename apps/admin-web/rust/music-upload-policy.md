# Music API Rust 移行 Part 1

Music 管理 API のアップロード予約で、申告容量、SHA256 表記、用途別 MIME を Rust Wasm で判定する
認可の後、D1 の予約作成の前に実行するため、実際のリクエスト経路で Rust を使用する
容量エラーを形式エラーより優先し、既存のエラーコードと本文を維持する
署名、Web Crypto、PHP の実体検証、ストリーム転送、認可、保存先は変更しない

## 構成と ABI

Cloudflare Worker は既存の Vite Wasm module import を使う
ダイジェストと MIME は各 64 バイトの固定領域に渡し、長さ超過は Rust で拒否する
呼び出しは同期で完結し、領域書き込みと判定の間に await を置かない
容量は f64 で渡し、Rust で有限性、整数性、安全整数範囲、正数、用途別上限を判定する
入力由来の可変メモリ確保や暗号実装を追加しない

## 検証

admin-web ディレクトリで実行する

```sh
node scripts/build-music-upload-policy.js
node --test tests/music-upload-policy.test.mjs tests/music-upload-runtime.test.mjs
```

差分テストは既存 JavaScript の条件と Wasm の結果を 3520 通り比較する
workerd テストは認可の先行、容量エラーの優先、形式拒否、正常時の予約引数を確認する

## ビルド統合

このブランチは PR #122 の `f24a18c316145ac7d48c08688a0cac9d424e6914` の上に積む
admin-web の `rust:build` は intake と Music 両方の Wasm を生成する
Music の predev、pretest、pretest:e2e、pretest:public は共通の Rust ビルドを呼ぶ
共有 Music harness は両方の Wasm module を登録する
生成 Wasm は ignore し、ソース管理に含めない

既存の Music validation と Management API validation の `apps/admin-web/**` と
`apps/music/**` の path 条件で、Rust ソース、生成スクリプト、受付ルール、共有 harness、
各テストの変更をすべて捕捉するため、CI の path 条件を増やす必要はない
admin-web の npm test は全体 build と Music 固有の workerd テストを含む
統合後も最終 SHA で CI が成功したことを確認してからリリースする

## 配備とロールバック

Cloudflare の既存 Worker と料金枠、D1、環境変数、認証設定を使う
PHP の api.php と bridge.php は変更せず、レンタルサーバーへの Rust 配備は行わない
DB マイグレーションや鍵変更は不要
統合後の Worker を既存手順で配備し、必要時は直前の Worker バージョンに戻す
この変更だけを戻す場合は受付の TypeScript 条件を復元し、Wasm import とビルド接続を外す
マージと配備は親の承認後に実施する
