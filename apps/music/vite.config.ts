import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// 本番とOAuth開発は同じWorkerを使用し、テスト認証を依存グラフへ入れない。
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: { host: "127.0.0.1", port: 5173 },
  build: { sourcemap: false },
});
