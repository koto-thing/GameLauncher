export const platforms = ["windows", "macos", "linux"] as const;
export type Platform = (typeof platforms)[number];
export type DownloadTarget =
  | { status: "available"; url: string; detail?: string }
  | { status: "comingSoon"; url: null };
export interface SiteConfig {
  title: string;
  tagline: string;
  logoUrl: string | null;
  background: {
    videoUrl: string | null;
    posterUrl: string | null;
    objectPosition: string;
  };
  downloads: Record<Platform, DownloadTarget>;
}

/** Validate a URL without network access; assets may use site-relative paths. */
export function validateUrl(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || /[\s\\<>"'`]/u.test(value)) {
    throw new Error("URL must be nonempty and contain no whitespace or unsafe characters");
  }
  if (/^https:\/\//u.test(value)) {
    const url = new URL(value);
    if (!url.hostname || url.username || url.password) throw new Error("Invalid HTTPS URL");
    return;
  }
  // Restrict local paths to the deployed site; no schemes, traversal, or protocol-relative URLs.
  if (/^[\w./~-]+(?:[?#][\w=&.%~-]+)?$/u.test(value) &&
      !value.startsWith("//") && !value.split(/[/?#]/u).includes("..") &&
      !["/", ".", "./"].includes(value)) return;
  throw new Error(`Invalid URL: ${value}`);
}

/** Validate the complete build-time configuration; invalid settings stop the build. */
export function validateConfig(config: SiteConfig): SiteConfig {
  if (typeof config.title !== "string" || !config.title.trim()) throw new Error("Title required");
  if (typeof config.tagline !== "string" || !config.tagline.trim()) throw new Error("Tagline required");
  for (const url of [config.logoUrl, config.background.videoUrl, config.background.posterUrl]) {
    if (url !== null) validateUrl(url);
  }
  // Two percentages are sufficient for editorial framing and cannot inject CSS declarations.
  if (!/^\d+(?:\.\d+)?% \d+(?:\.\d+)?%$/u.test(config.background.objectPosition) ||
      config.background.objectPosition.split(" ").some(value => parseFloat(value) > 100)) {
    throw new Error("objectPosition must be two percentages between 0% and 100%");
  }
  for (const platform of platforms) {
    const target = config.downloads[platform];
    if (target?.status === "available") {
      validateUrl(target.url);
      if (target.detail !== undefined && typeof target.detail !== "string") throw new Error("Invalid detail");
    } else if (target?.status !== "comingSoon" || target.url !== null) {
      throw new Error(`Invalid download target: ${platform}`);
    }
  }
  return config;
}

/** Resolve local assets against Vite's base; absolute HTTPS URLs remain unchanged. */
export function siteUrl(url: string, base: string): string {
  return url.startsWith("https://") ? url : `${base}${url.replace(/^(?:\.\/|\/)/u, "")}`;
}
