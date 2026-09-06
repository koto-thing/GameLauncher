import { build } from "esbuild";
// 実音声エンジンをテスト専用URLで読み込む。公開distへは含めない。
await build({
  stdin: {
    contents:
      'export { BrowserAudio } from "./src/infrastructure/audio/browser-audio"; export { PLAYER_RUNTIME_DEFAULTS } from "./src/config/player-runtime.defaults"; export { startRegionSource } from "./src/infrastructure/audio/region-source";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  outfile: "build/audio-harness.js",
});
