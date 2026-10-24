# Distribution contracts

PublisherとLauncherが共有するRustライブラリです。

- 配布マニフェストの型、JSON Schema検証、パス・サイズ・チャンク整合性検証
- 署名対象JSONの正規化、Ed25519署名検証（Publisherの署名生成は`signing` feature）
- 配布URLの解析と呼び出し元が指定する許可hostの検証

Launcherは`apps/launcher/rust`のCXX静的ライブラリ経由で元のJSONバイト列を渡します。
重複フィールド、不正な数値、未知フィールドを解析時に拒否し、全検証を通過した型だけを返します。
公開鍵と許可hostの選択は各アプリケーションが担当します。

リポジトリルートで`cargo test --workspace --locked`を実行してください。
`tests/fixtures`の署名済みJSONはRustとC++の両方で使用します。
