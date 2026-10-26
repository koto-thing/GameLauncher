import { defineConfig, loadEnv } from "vite-plus";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "LT_");
  return {
    server: {
      host: "127.0.0.1",
      proxy: env.LT_API_PROXY
        ? { "/api/lt": { target: env.LT_API_PROXY, changeOrigin: false } }
        : undefined,
    },
    test: { include: ["src/**/*.test.ts"] },
  };
});
