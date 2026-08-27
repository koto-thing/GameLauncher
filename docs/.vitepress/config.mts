import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  lastUpdated: true,
  sitemap: { hostname: "https://koto-thing.github.io/GameLauncher/" },
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
    ["meta", { name: "theme-color", content: "#7257d9" }],
  ],
  themeConfig: {
    siteTitle: "PandD Docs",
    search: { provider: "local" },
    nav: [
      { text: "ガイド", link: "/guide/" },
      { text: "アーキテクチャ", link: "/architecture/platform" },
      { text: "API", link: "/reference/" },
      { text: "運用", link: "/OPERATIONS" },
    ],
    sidebar: {
      "/guide/": [
        { text: "はじめに", items: [
          { text: "ローカル開発", link: "/guide/" },
          { text: "Launcher開発", link: "/guide/launcher-development" },
          { text: "Admin Web開発", link: "/guide/admin-web-development" },
        ] },
        { text: "リリース", items: [
          { text: "Launcher公開", link: "/guide/launcher-release" },
          { text: "ゲーム配信", link: "/guide/game-deployment" },
          { text: "Admin Web公開", link: "/guide/admin-web-deployment" },
          { text: "運用と障害対応", link: "/guide/operations" },
        ] },
      ],
      "/architecture/": [
        { text: "アーキテクチャ", items: [
          { text: "プラットフォーム", link: "/architecture/platform" },
          { text: "信頼境界", link: "/architecture/trust-boundaries" },
        ] },
      ],
      "/reference/": [
        { text: "リファレンス", items: [
          { text: "概要", link: "/reference/" },
          { text: "Launcher C++ API", link: "/reference/launcher-api" },
          { text: "Admin HTTP API", link: "/reference/admin-api" },
          { text: "JSON Schema", link: "/reference/schemas" },
        ] },
      ],
      "/": [
        { text: "プロジェクト", items: [
          { text: "概要", link: "/" },
          { text: "開発状況", link: "/IMPLEMENTATION_STATUS" },
          { text: "セキュリティ", link: "/security" },
          { text: "利用規約", link: "/TERMS_OF_USE" },
          { text: "プライバシー", link: "/PRIVACY_POLICY" },
          { text: "ライセンス", link: "/licenses" },
        ] },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/koto-thing/GameLauncher" }],
    footer: { message: "PandD Platform Documentation", copyright: "Copyright © PandD" },
    outline: { level: [2, 3], label: "このページ" },
    docFooter: { prev: "前へ", next: "次へ" },
    lastUpdated: { text: "最終更新" },
  },
};
