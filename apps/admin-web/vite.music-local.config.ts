import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import path from "node:path";

// 専用コマンドだけで使用し、本番bindingや既存ローカルD1へ接続しない。
const directory = process.env.MUSIC_LOCAL_DIRECTORY || path.resolve("build/music-local");
export default defineConfig({ server: { host: "127.0.0.1", port: 8788, strictPort: true }, plugins: [vinext(), cloudflare({ configPath: path.join(directory, "wrangler.json"), persistState: { path: path.join(directory, "state") }, remoteBindings: false, viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } })] });
