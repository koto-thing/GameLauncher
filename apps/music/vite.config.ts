import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 公開サイトは静的buildのみ。API・音源・画像は同一レンタルサーバーが配信する。
export default defineConfig({
  base: process.env.MUSIC_BASE_PATH || "/",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173 },
  build: { sourcemap: false },
});
