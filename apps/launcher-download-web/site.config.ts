import type { SiteConfig } from "./src/config.ts";

// This file is the only source of product text, media URLs and download destinations.
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
      // Verified public, non-prerelease asset on 2026-09-06. Update only after verification.
      url: "https://github.com/koto-thing/GameLauncher-Releases/releases/download/v1.0.5/PandD-Game-Launcher-Online-Installer.exe",
      detail: "x86_64",
    },
    macos: { status: "comingSoon", url: null },
    linux: { status: "comingSoon", url: null },
  },
} satisfies SiteConfig;
