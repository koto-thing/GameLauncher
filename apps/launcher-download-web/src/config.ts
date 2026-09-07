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

/**
 * @brief ネットワークアクセスなしで公開URLを検証する
 * @param value 検証するURL
 * @throws URLの形式や公開範囲が不正な場合
 */
export function validateUrl(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value || /[\s\\<>"'`]/u.test(value)) {
    throw new Error("URL must be nonempty and contain no whitespace or unsafe characters");
  }
  if (/^https:\/\//u.test(value)) {
    const url = new URL(value);

    if (!url.hostname || url.username || url.password) throw new Error("Invalid HTTPS URL");

    return;
  }

  // ローカル素材は配布サイト内に限定し、スキーム・親ディレクトリ・protocol-relative URLを拒否する
  if (/^[\w./~-]+(?:[?#][\w=&.%~-]+)?$/u.test(value) &&
      !value.startsWith("//") && !value.split(/[/?#]/u).includes("..") &&
      !["/", ".", "./"].includes(value)) return;

  throw new Error(`Invalid URL: ${value}`);
}

/**
 * @brief ビルド時設定全体を検証し、不正な配布設定での生成を止める
 * @param config 検証するサイト設定
 * @returns 検証済みのサイト設定
 * @throws 必須項目や配布対象が不正な場合
 */
export function validateConfig(config: SiteConfig): SiteConfig {
  // 表示文言が空だと静的ページの主要な導線が成立しないため、生成前に拒否する
  if (typeof config.title !== "string" || !config.title.trim()) throw new Error("Title required");
  if (typeof config.tagline !== "string" || !config.tagline.trim()) throw new Error("Tagline required");

  // 外部URLとローカル素材を同じ公開範囲の検証へ通し、設定経路だけの抜け道を作らない
  for (const url of [config.logoUrl, config.background.videoUrl, config.background.posterUrl]) {
    if (url !== null) validateUrl(url);
  }

  // 2つのパーセント値だけを許可し、CSS宣言の注入経路を作らない
  if (!/^\d+(?:\.\d+)?% \d+(?:\.\d+)?%$/u.test(config.background.objectPosition) ||
      config.background.objectPosition.split(" ").some(/** @brief パーセント値の上限超過を拒否する @param value 検査する値 */ value => parseFloat(value) > 100)) {
    throw new Error("objectPosition must be two percentages between 0% and 100%");
  }

  // 配布状態とURLの組み合わせを固定し、準備中リンクが誤って公開されるのを防ぐ
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

/**
 * @brief Viteのbaseにローカル素材を結び付け、HTTPS URLはそのまま返す
 * @param url 解決する素材URL
 * @param base 配置先のbase URL
 * @returns 配布ページから参照できるURL
 */
export function siteUrl(url: string, base: string): string {
  return url.startsWith("https://") ? url : `${base}${url.replace(/^(?:\.\/|\/)/u, "")}`;
}
