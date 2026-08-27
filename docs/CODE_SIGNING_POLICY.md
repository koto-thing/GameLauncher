# Code signing policy

## 現在の状態

PandD Game Launcher は SignPath Foundation の OSS コード署名へ未登録です。登録が完了するまでは、SignPath Foundation が発行した証明書による署名済み成果物として配布しません。

申請前に、リポジトリ全体へ適用する OSI 承認済みライセンスの決定と、Live2D Cubism Core を含む独自仕様コンポーネントが SignPath Foundation の条件に適合するかの確認が必要です。

## チームの役割

- Committer と reviewer: [koto-thing](https://github.com/koto-thing)
- Signing approver: [koto-thing](https://github.com/koto-thing)

外部 contributor の変更は reviewer が確認します。署名対象は保護された既定ブランチのレビュー済みコミットから GitHub Actions が再現可能に生成した正式リリース成果物だけに限定します。

## 署名対象

- PandD Game Launcher の実行ファイルとインストーラー
- 同じリリース処理で生成したチェックサムと SBOM に対応する成果物

第三者の実行ファイルやライブラリを PandD Game Launcher の成果物として個別に署名しません。

## 承認と検証

署名要求ごとに approver の手動承認を必須とします。署名前にソースコミット、バージョン、ビルド元ワークフロー、成果物ハッシュ、SBOM、マルウェア検査結果を確認します。

署名用秘密鍵をリポジトリ、GitHub Actions のログ、Artifact、開発者端末へ保存しません。リポジトリと署名サービスへアクセスできる全メンバーは多要素認証を有効にします。

## プライバシー

利用者データの扱いは [Privacy Policy](PRIVACY_POLICY.md) に従います。ランチャーは利用者が要求した配信処理以外で情報を外部へ送信しません。
