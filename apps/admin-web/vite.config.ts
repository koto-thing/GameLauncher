import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

// VinextとCloudflare Worker環境を組み合わせた管理アプリの開発・ビルド設定
// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

/**
 * 管理アプリと共有フォームの依存関係を同じインストール先から解決する
 * @returns Cloudflare向けのVite設定
 */
export default defineConfig(() => {
  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    resolve: { dedupe: ["simple-icons", "lucide-react"] },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      }),
    ],
  };
});
