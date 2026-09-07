import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// 管理ビルドは既存control-planeだけに配置し、公開サイトへコピーしない
export default defineConfig({
  plugins: [
    react(),
    {
      name: "music-loudness-licenses",
      /** @brief 配信する管理バンドルに測定ライブラリのMIT表示を添付する */
      generateBundle() {
        const source = ["LICENSE-LoudnessMeter", "LICENSE-wasm-bindgen"]
          .map(
            /** @brief 固定依存の同梱ライセンスだけを配布する */ (name) =>
              `${name}\n${readFileSync(new URL(`../../packages/music-loudness/${name}`, import.meta.url), "utf8")}`,
          )
          .join("\n\n");
        this.emitFile({
          type: "asset",
          fileName: "loudness-licenses.txt",
          source,
        });
      },
    },
  ],
  resolve: { dedupe: ["react", "react-dom"] },
  define: { "process.env.NODE_ENV": '"production"' },
  publicDir: false,
  base: "/music-editor/",
  build: {
    outDir: "../admin-web/public/music-editor",
    emptyOutDir: true,
    lib: {
      entry: "src/composition/manager.tsx",
      name: "PandDMusicManager",
      formats: ["iife"],
      fileName: /** @brief control-planeの固定entry名を維持する */ () =>
        "manager.js",
      cssFileName: "manager",
    },
  },
});
