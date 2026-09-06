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
      handler: () => renderPage(config, base),
    },
    // Production URLs are relative by default, and --base also applies to configured assets.
    configResolved(resolved) {
      base = resolved.base;
    },
    handleHotUpdate(context) {
      if (context.file.endsWith("site.config.ts")) void context.server.restart();
    },
  }],
});
