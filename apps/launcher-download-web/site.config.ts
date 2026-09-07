import type { SiteConfig } from "./src/config.ts";

// 商品文言・メディアURL・配布先をこのファイルだけで管理する
export default {
  title: "Play and Discover",
  tagline: "遊び心が、動き出す。",
  logoUrl: "media/pandd-logo.png",
  background: {
    videoUrl: "media/showreel-202609-v1.mp4",
    posterUrl: "media/showreel-202609-v1.jpg",
    objectPosition: "50% 50%",
  },
  downloads: {
    windows: {
      status: "available",
      // 2026-09-06に検証済みの公開・非プレリリース素材で、検証後だけ更新する
      url: "https://github.com/koto-thing/GameLauncher-Releases/releases/download/v1.0.5/PandD-Game-Launcher-Online-Installer.exe",
      detail: "x86_64",
    },
    macos: { status: "comingSoon", url: null },
    linux: {
      status: "available",
      // 2026-09-06に検証済みの公開・非プレリリース素材
      url: "https://github.com/koto-thing/GameLauncher/releases/download/v1.1.0/PandD-Game-Launcher-Online-Installer",
      detail: "x86_64",
    },
  },
} satisfies SiteConfig;
