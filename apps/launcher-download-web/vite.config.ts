import { defineConfig } from "vite";
import config from "./site.config.ts";
import { renderPage } from "./src/render.ts";

let base = "./";
export default defineConfig({
  base: "./",
  plugins: [{
    name: "launcher-static-page",
    transformIndexHtml: {
      order: "pre",
      handler: /** @brief 検証済み設定から静的HTMLを生成する */ () => renderPage(config, base),
    },
    // 本番URLは既定で相対指定とし、--baseを設定素材にも適用する
    configResolved: /** @brief Vite確定後のbase URLをHTML生成へ渡す */ (resolved) => {
      base = resolved.base;
    },
    handleHotUpdate: /** @brief 設定変更時だけ開発サーバーを再起動する */ (context) => {
      if (context.file.endsWith("site.config.ts")) void context.server.restart();
    },
  }],
});
