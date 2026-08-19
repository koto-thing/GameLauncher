# ランチャーUIの翻訳

対応言語は `locales.json`、翻訳は `launcher_<BCP 47言語タグ>.ts` で管理します。
初期同梱言語は日本語（ソース文字列）と英語です。

画面文字列を追加・変更した後は次を実行します。

```powershell
.\scripts\local\Update-LauncherTranslations.ps1
```

Qt Linguistで `.ts` を開いて翻訳し、CMakeでビルドすると `.qm` が生成されて
ランチャーへ埋め込まれます。新しい言語を追加するときは、次の両方を追加します。

1. `locales.json` の言語コードと母語名
2. `launcher_<locale>.ts` の翻訳ファイル

選択言語の翻訳ファイルまたは項目がない場合、Qtは日本語のソース文字列を表示します。
ゲーム情報やお知らせなどの配布コンテンツも、同じBCP 47言語タグを使用します。
