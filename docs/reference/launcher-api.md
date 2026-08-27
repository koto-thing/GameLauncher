# Launcher C++ API

公開リファレンスはソース内Doxygenコメントから生成されます。手書きのクラス一覧は管理しません。

<a href="./cpp/index.html" class="VPButton medium brand">生成済みC++ APIを開く</a>

## ローカル生成

```powershell
cmake --preset clion-windows
cmake --build --preset clion-windows --target docs-check
```

GitHub Pages workflowはDoxygenを有効にして `apps/launcher/src` だけを処理し、生成HTMLをPages artifactの `reference/cpp/` へ配置します。未文書化の公開APIやDoxygen warningはbuild failureです。
