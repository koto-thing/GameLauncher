import { readFile } from "node:fs/promises";
import { preview } from "vite";
import config from "../site.config.ts";
import type { SiteConfig } from "../src/config.ts";
import { renderPage } from "../src/render.ts";

/** Start a loopback-only test server; caller owns and closes its HTTP listener. */
export async function startTestServer() {
const mediaRequests = new Map<string, number>();
const pendingMedia: Array<() => void> = [];
const built = await readFile("dist/index.html", "utf8");
const script = built.match(/<script\b[^>]*src="([^"]+)"/u)![1];
const style = built.match(/<link\b[^>]*href="([^"]+\.css)"/u)![1];

// Test-only routes use the production renderer and compiled assets. Never copied into dist.
return preview({
  configFile: false,
  base: "/launcher/",
  preview: { host: "127.0.0.1", port: 5181, strictPort: true },
  plugins: [{
    name: "local-test-fixtures",
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url!, "http://127.0.0.1:5181");
        const pathname = requestUrl.pathname;
        const mediaKey = `${requestUrl.searchParams.get("case")}:${requestUrl.searchParams.get("run")}`;
        if (pathname === "/launcher/fixtures/release-pending") {
          pendingMedia.splice(0).forEach(release => release());
          res.end("released");
          return;
        }
        if (pathname === "/launcher/fixtures/requests") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(mediaRequests.get(mediaKey) ?? 0));
          return;
        }
        if (pathname === "/launcher/fixtures/network.mp4") { res.destroy(); return; }
        if (pathname === "/launcher/fixtures/unsupported.mp4") {
          res.setHeader("Content-Type", "video/mp4");
          res.end("not a video");
          return;
        }
        if (pathname === "/launcher/fixtures/missing.mp4" || pathname === "/launcher/fixtures/missing.svg") {
          res.statusCode = 404;
          res.end("missing test fixture");
          return;
        }
        if (pathname === "/launcher/fixtures/video.mp4" || pathname === "/launcher/fixtures/pending.mp4") {
          mediaRequests.set(mediaKey, (mediaRequests.get(mediaKey) ?? 0) + 1);
          if (pathname.endsWith("/pending.mp4")) await new Promise<void>(resolve => pendingMedia.push(resolve));
          const bytes = await readFile("tests/fixtures/video.mp4");
          res.setHeader("Content-Type", "video/mp4");
          res.setHeader("Accept-Ranges", "bytes");
          const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/u);
          if (range) {
            const start = Number(range[1]);
            const end = Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1);
            res.statusCode = 206;
            res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
            res.end(bytes.subarray(start, end + 1));
          } else res.end(bytes);
          return;
        }
        if (pathname === "/launcher/fixtures/poster.svg") {
          res.setHeader("Content-Type", "image/svg+xml");
          res.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#66858a"/></svg>');
          return;
        }
        if (!pathname.startsWith("/launcher/cases/")) { next(); return; }
        const mode = pathname.split("/").at(-1);
        const fixture = structuredClone(config) as SiteConfig;
        fixture.background.videoUrl = `fixtures/video.mp4?case=${mode}&run=${requestUrl.searchParams.get("run") ?? "default"}`;
        fixture.background.posterUrl = "fixtures/poster.svg";
        if (mode === "pending") fixture.background.videoUrl = "fixtures/pending.mp4?case=pending&run=default";
        if (mode === "all-available") {
          fixture.downloads.macos = { status: "available", url: "fixtures/local-test-mac.zip", detail: "Apple Silicon" };
          fixture.downloads.linux = { status: "available", url: "fixtures/local-test-linux.tar.gz", detail: "テスト専用の長い対応対象表記で折り返しを検証" };
        }
        if (mode === "404" || mode === "both-missing") fixture.background.videoUrl = "fixtures/missing.mp4";
        if (mode === "network" || mode === "unsupported") fixture.background.videoUrl = `fixtures/${mode}.mp4`;
        if (mode === "both-missing") fixture.background.posterUrl = "fixtures/missing.svg";
        if (mode === "empty") {
          fixture.background.videoUrl = null;
          fixture.background.posterUrl = null;
          fixture.logoUrl = null;
        }
        if (mode === "poster-only") fixture.background.videoUrl = null;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderPage(fixture, "/launcher/")
          .replace('src="/src/main.ts"', `src="${script}"`)
          .replace('href="/src/style.css"', `href="${style}"`));
      });
    },
  }],
});
}
