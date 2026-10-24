# 管理 API Rust 移行 Part 1

`GET /api/intake/config` の `partSize` と `uploadUrlLifetimeSeconds` を Rust の
Wasm エクスポートからリクエストごとに取得する
公開 GitHub client ID とローカル認証判定は既存 TypeScript を維持する
アップロード処理側の既存定数との一致は Worker 統合テストで検証する
認証・権限・DB・R2・CORS・配信設定は変更しない

## ビルド

リポジトリの `rust-toolchain.toml` が指定する Rust 1.94.1 を使用する

```sh
rustup target add wasm32-unknown-unknown
npm ci --prefix apps/admin-web
npm ci --prefix apps/music
npm test --prefix apps/admin-web
npm run lint --prefix apps/admin-web
```

`prebuild` と `predev` が rustc で Wasm を生成する
外部 Rust crate、wasm-pack、wasm-bindgen、追加 Worker は不要
生成物は Git 管理外で、Cloudflare Vite plugin の `?module` が Worker の
Wasm モジュール import に変換する

## API の境界

| 領域 | 実装・担当範囲 |
| --- | --- |
| 管理・制御 | apps/admin-web の Vinext API routes、D1、R2 |
| Analytics | services/platform-api、独立 Worker と D1、別担当 |
| Download | apps/launcher-download-worker、独立 Worker と R2、別担当 |
| Music 管理 | apps/admin-web/app/api/music と music 配下 |
| Music 公開 API・bridge | server/music の PHP、既存レンタルサーバー |
| 既存 Rust | launcher、deployment_publisher、transfer、local-storage、file-integrity、distribution-contracts、music-loudness |

Music の PHP hosting については Rust プロセスや Wasm を実行できる証拠がない
PHP の API・bridge を置換する前にホストの実行制約と署名契約を確認する
今回の変更でホスト変更や課金は発生しない

## 統合・リリース

1. 各担当の exact SHA で Rust テスト、既存契約テスト、Worker build と dry-run を確認する
2. 親が共有 CI の競合を確認し、draft PR を順番に統合する
3. 統合 SHA で各サービスの全テストと dry-run を再実行する
4. 親のリリース指示を受けて staging の認証・権限・エラー・CORS を検証する
5. 承認された同一 SHA を本番へ展開する

今回 DB migration や binding 変更はない
ロールバックは直前の Worker version へ戻すか、このコミットを revert して
元の TypeScript 設定 API を再ビルドする
現段階で merge・deploy は実行しない
