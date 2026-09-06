import assert from "node:assert/strict";
import { test } from "node:test";
import config from "../site.config.ts";
import { validateConfig, validateUrl, siteUrl } from "../src/config.ts";
import type { SiteConfig } from "../src/config.ts";
import { renderPage } from "../src/render.ts";

test("production settings generate real HTML links and disabled unpublished OS slots", () => {
  const html = renderPage(validateConfig(config), "/launcher/");
  assert.ok(html.includes(`href="${config.downloads.windows.url}"`));
  assert.match(html, /data-platform="macos"[^>]*disabled/u);
  assert.ok(html.includes(`href="${config.downloads.linux.url}"`));
  assert.doesNotMatch(html, /href="#"|<video[^>]*\ssrc=|<video[^>]*\sautoplay/u);
  assert.match(html, /src="\/launcher\/media\/pandd-logo.png"/u);
});

test("empty, unsafe and ambiguous URLs stop a build", () => {
  for (const url of ["", " ", "http://example.com/a", "javascript:alert(1)", "data:text/html,a", "//evil.test/a", "../a", "media/../a", "#", "/", "https://u:p@host.test/a", "https://x.test/\"x", "media\\a.mp4"]) {
    assert.throws(() => validateUrl(url), Error, url);
  }
  for (const url of ["https://example.com/video.mp4?v=2", "media/video.mp4", "./media/a.png", "/media/a.png"]) validateUrl(url);
  assert.equal(siteUrl("/media/a.png", "/launcher/"), "/launcher/media/a.png");
});

test("available and comingSoon are mutually exclusive settings", () => {
  for (const target of [{ status: "available", url: null }, { status: "comingSoon", url: "https://example.com/a" }, { status: "invalid", url: null }]) {
    const invalid = structuredClone(config) as SiteConfig;
    invalid.downloads.macos = target as SiteConfig["downloads"]["macos"];
    assert.throws(() => validateConfig(invalid));
  }
});

test("configuration text is escaped and CSS framing is validated", () => {
  const special = structuredClone(config) as SiteConfig;
  special.title = '<script>"&\'</script>';
  special.downloads.windows = { ...config.downloads.windows, detail: '\"><img src=x onerror=alert(1)>' };
  const html = renderPage(special, "./");
  assert.ok(html.includes("&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;"));
  assert.doesNotMatch(html, /<img src=x/u);
  special.background.objectPosition = "50%; color:red";
  assert.throws(() => validateConfig(special));
});

test("all three OS can become available without changing their order or dimensions", () => {
  const all = structuredClone(config) as SiteConfig;
  all.downloads.macos = { status: "available", url: "media/test-mac.zip", detail: "Apple Silicon" };
  all.downloads.linux = { status: "available", url: "media/test-linux.tar.gz", detail: "x86_64" };
  const html = renderPage(all, "/launcher/");
  assert.equal((html.match(/<a class="download"/gu) ?? []).length, 3);
  assert.ok(html.indexOf('data-platform="windows"') < html.indexOf('data-platform="macos"'));
  assert.ok(html.indexOf('data-platform="macos"') < html.indexOf('data-platform="linux"'));
  assert.match(html, /href="\/launcher\/media\/test-mac.zip"/u);
});
