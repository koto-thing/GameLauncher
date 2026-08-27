# JSON Schema

canonical schemaは `packages/contracts/schemas` にあります。Admin Webのvalidator、Publisher、Launcher向け配信データはこの原本と整合させます。

| Schema | 用途 |
| --- | --- |
| `announcements-source.schema.json` | 編集用お知らせ |
| `announcements.schema.json` | Launcher向け公開お知らせ |
| `catalog.schema.json` | ゲームカタログ |
| `deployment-artifact-descriptor.schema.json` | Intake Artifactの不変descriptor |
| `game-release-source.schema.json` | ゲームrelease編集入力 |
| `game-release.schema.json` | 署名済みゲームrelease |
| `launcher-changelog.schema.json` | Launcher更新履歴 |
| `launcher-release-source.schema.json` | Launcher release編集入力 |
| `launcher-release.schema.json` | Launcher公開release |

## 検証

```powershell
python -m unittest discover -s packages/contracts -p "test_*.py" -v
```

Schemaを変更した場合は、互換層を追加せず利用側とexampleを同じ変更で更新します。
