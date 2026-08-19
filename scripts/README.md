# Scripts

プロジェクトの自動化スクリプトは用途ごとに分けています。

| Directory | Contents |
| --- | --- |
| `deployment/` | Intake artifact の検証、Control Plane 連携、ゲーム公開の検証 |
| `release/` | リリースバージョン、checksum、SBOM、ライセンスの処理 |
| `local/` | ローカル開発用の起動、環境変数読み込み、翻訳更新 |
| `signing/` | Linux / macOS の署名処理 |
| `verification/` | Windows launcher の smoke test |
| `tests/` | 上記 Python スクリプトの unit test |

Python スクリプトはリポジトリルートから module として実行します。

```text
python -m scripts.release.validate_release_version v1.0.0
python -m unittest discover -s scripts/tests -p "test_*.py" -v
```
