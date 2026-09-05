import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import navigation from "../navigation.json" with { type: 'json' };
import manifest from '../../apps/docs/editor-manifest.json' with { type: 'json' };

const rawBase = process.env.DOCS_BASE_PATH?.trim() || "/";
const base = rawBase === "/" ? "/" : `/${rawBase.replace(/^\/+|\/+$/g, "")}/`;
const logo = readFileSync(resolve(import.meta.dirname, "../../assets/images/PandDLogo.png")).toString("base64");

export default {
  lang: "ja-JP",
  title: "PandD Platform Docs",
  description: "PandD Game Launcherと運営用Admin Webの開発・配信・APIドキュメント",
  base,
  outDir: "../apps/docs/dist",
  cacheDir: "../apps/docs/.vitepress/cache",
  cleanUrls: true,
  appearance: 'dark',
  // These two references are generated after VitePress; check-built-site verifies them.
  ignoreDeadLinks: [/^\.\/(?:admin|cpp)\/index(?:\.html)?$/],
  lastUpdated: true,
  transformPageData(pageData) {
    if (pageData.relativePath === 'index.md') Object.assign(pageData.frontmatter, { aside: false, prev: false, next: false });
    if (pageData.relativePath === 'editor.md') delete pageData.lastUpdated;
  },
  transformHead({ pageData }) {
    const route = pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '');
    return [['link', { rel: 'canonical', href: `${process.env.DOCS_ORIGIN || 'https://koto-thing.github.io'}${base}${route}` }]];
  },
  sitemap: { hostname: (process.env.DOCS_ORIGIN || "https://koto-thing.github.io") + base },
  vite: {
    resolve: {
      alias: [
        {
          find: "vue/server-renderer",
          replacement: resolve(import.meta.dirname, "../../apps/docs/node_modules/@vue/server-renderer/dist/server-renderer.esm-bundler.js"),
        },
        {
          find: /^vue$/,
          replacement: resolve(import.meta.dirname, "../../apps/docs/node_modules/vue/dist/vue.runtime.esm-bundler.js"),
        },
      ],
    },
  },
  head: [
    ["link", { rel: "icon", type: "image/png", href: `data:image/png;base64,${logo}` }],
    ["meta", { name: "theme-color", content: "#242426" }],
  ],
  themeConfig: {
    publicVersion: (process.env.DOCS_COMMIT_SHA || process.env.GITHUB_SHA || 'local').slice(0, 8),
    siteTitle: "PANDD_DOCS",
    search: { provider: "local", options: {
      async _render(src, env, md) {
        const path = env.relativePath?.replace(/\\/g, '/');
        if (!Object.values(manifest).some(doc => doc.path === `docs/${path}`) && !/^guide\/[a-z0-9-]+\.md$/.test(path || '')) return '';
        return md.renderAsync(src, env);
      },
    } },
    nav: navigation.nav,
    sidebar: navigation.sidebar,
    socialLinks: [{ icon: "github", link: "https://github.com/koto-thing/GameLauncher" }],
    footer: { message: "PandD Platform Documentation", copyright: "Copyright © PandD" },
    outline: { level: [2, 3], label: "このページ" },
    docFooter: { prev: "前へ", next: "次へ" },
    lastUpdated: { text: "最終更新" },
  },
};
