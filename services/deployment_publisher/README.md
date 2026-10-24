# Rust Publisher

`pandd-publisher` は、ビルド済みゲームの検証、64 MiBチャンクへの分割、SHA-256計算、
Ed25519署名、公開JSONの生成、R2への公開、旧配信物の整理を行うCLIです。
Web Uploaderの画面や申請・承認処理は含みません。

## ビルドと実行

Rust 1.94.1以降と各OSのRustネイティブビルド環境を使用します。
リポジトリルートで次を実行すると、CLIをCargoのbinディレクトリにインストールできます。
そのディレクトリをPATHに追加してください。

```text
cargo install --locked --path services/deployment_publisher
pandd-publisher --help
```

開発用のビルドは以下です。Windowsでは出力ファイルに`.exe`が付きます。

```text
cargo build --release --locked --manifest-path services/deployment_publisher/Cargo.toml
target/release/pandd-publisher --help
```

署名鍵は従来のEd25519 PKCS#8 PEM形式を使用します。Publisherの署名と鍵生成に
OpenSSL実行ファイルは不要です。R2へのアップロード・一覧・削除にはPATH上のAWS CLI v2を使用し、
既存のAWS認証環境変数を引き継ぎます。AWS CLIのmultipart uploadも継続して利用します。
JSON Schemaはビルド時に埋め込むため、実行時にソースツリーやPythonは不要です。

## コマンド

| コマンド | 処理 |
| --- | --- |
| `init-key` | Ed25519鍵ペアを生成。既存鍵の上書きは禁止 |
| `publish-game` | ゲームの分割・ハッシュ・署名・カタログ生成。接続先を指定した場合は公開も実行 |
| `publish-announcements` | お知らせの公開JSONを生成 |
| `publish-launcher` | OS・アーキテクチャ別のQt IFW更新情報を生成 |
| `publish-changelog` | 言語別の更新履歴を生成 |
| `upload-immutable` | 固定配信物だけをアップロードしてメタデータを照合 |
| `promote-pointers` | 固定配信物を再確認後、カタログと最新版参照を更新 |
| `upload` | 固定配信物から最新版参照まで順序を守って公開 |
| `gc-local` / `gc-remote` | 現行版・直前版を保持し、7日以上経過した不要配信物を整理。`--dry-run`で確認可能 |
| `sign-file` | 物理版の配信記述などのファイルを署名し、Base64署名だけを標準出力に返す |

各コマンドの必須引数は`pandd-publisher <command> --help`で確認できます。

## 処理と公開の境界

- 独立したゲームファイルを最大4並列で分割・ハッシュ計算します。単一ファイル内の順序は維持します
- 分割用バッファは最大4 × 64 MiBです。既存チャンクの照合やJSON等のメモリは別途使用します
- 同じ名前の固定配信物が異なる内容なら、ローカル・リモートとも上書きせず失敗します
- リモートのサイズ・SHA-256メタデータ・Content-Typeを照合してから最新版参照を更新します
- リモートの権限・通信エラーを「オブジェクトが存在しない」として扱いません
- シンボリックリンク、Windows junction、不正な相対パスを拒否します
- キャンセル要求は固定配信物の処理中と参照更新前に確認します。参照更新開始後は順番に書き切ります
- 複数のR2オブジェクトの更新はトランザクションではありません。途中の通信障害は失敗として報告します
- GCは現行版・直前版と参照チャンクが存在することを確認し、削除計画を完成させてから削除します

GitHub Actionsの公開ジョブはRust CLIをビルドして利用します。古いPython Publisherは削除済みです。
Pythonの申請検証・公開結果検証・物理版作成・Uploaderが共有するJSON検証は
`packages/contracts/validation.py`にあり、Publisherの代替実装ではありません。

## 検証

```text
cargo fmt --manifest-path services/deployment_publisher/Cargo.toml --check
cargo clippy --locked --manifest-path services/deployment_publisher/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path services/deployment_publisher/Cargo.toml
python -m pip install --requirement packages/contracts/requirements.txt
python -m unittest discover -s services/deployment_publisher/tests -p "test_*.py" -v
```

PythonのCLIテストではPATH上の`pandd-publisher`を使用します。
`PANDD_PUBLISHER`にビルドした実行ファイルの絶対パスを指定することもできます。
既存クライアントとの署名形式の照合にはOpenSSLを使用します。
PATHにない場合は`OPENSSL_EXECUTABLE`で指定してください。
本番R2への書き込みはテストで行いません。

## ローカル性能測定

2026-10-25にWindows上で、移行前のPython CLIとRustのreleaseビルドを比較しました。
同じ入力と同じEd25519鍵を使い、各回で空の出力ディレクトリに`publish-game`を実行しています。
プロセス起動、入力検証、分割、ハッシュ計算、署名、JSON・チャンクの書き込みを含み、
R2へのアップロードとRustのコンパイル時間は含みません。

| 合成入力 | Pythonの中央値 | Rustの中央値 | 比率 |
| --- | ---: | ---: | ---: |
| 32 MiB × 8ファイル（合計256 MiB） | 2.603秒 | 1.089秒 | 約2.4倍 |
| 4 KiB × 1,000ファイル | 23.902秒 | 0.460秒 | 約52倍 |

各3回で実行順を交互に変更しました。OSキャッシュは消去していません。
小ファイルではファイルサイズに合わせたバッファ確保と並列処理の効果が大きく出ています。
これはこのPC・合成入力での結果で、実ゲームやGitHub Actionsでの高速化率を保証するものではありません。
どちらの入力でも署名を含むマニフェストのJSON内容が旧Python版と完全一致することを確認しました。

生の秒数は、256 MiB入力がPython `[1.764, 3.320, 2.603]`、Rust `[0.941, 1.711, 1.089]`、
小ファイル入力がPython `[23.272, 24.437, 23.902]`、Rust `[0.460, 0.452, 0.553]`です。

マニフェストの型・整合性検証・正規化JSON・Ed25519処理は
`packages/distribution-contracts`をLauncherと共有します。
Cargo workspaceとlockfileはリポジトリルートにあります。

ファイルのSHA-256計算とチャンク分割は`packages/file-integrity`を使用します。
Launcherのファイル検証・検証付き結合・既存ゲーム取り込みも同じcrateを使用します。

JSONの原子的保存とローカルGCの安全な削除は`packages/local-storage`をLauncherと共有します。
保持期間やR2上のGC計画はPublisher側で管理します。
