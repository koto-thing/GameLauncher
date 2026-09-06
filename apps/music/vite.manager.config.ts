import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 管理ビルドは既存control-planeだけに配置し、公開サイトへコピーしない。
export default defineConfig({ plugins: [react()], resolve: { dedupe: ["react", "react-dom"] }, define: { "process.env.NODE_ENV": '"production"' }, publicDir: false, base: "/music-editor/", build: {
  outDir: "../admin-web/public/music-editor", emptyOutDir: true,
  lib: { entry: "src/composition/manager.tsx", name: "PandDMusicManager", formats: ["iife"], fileName: /** @brief control-planeの固定entry名を維持する。 */ () => "manager.js", cssFileName: "manager" },
} });
