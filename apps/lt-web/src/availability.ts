/** 本番では明示設定がある場合だけ申請機能を表示する */
export function applicationFeaturesEnabled(development: boolean, configured?: string): boolean {
  return configured === "true" || (development && configured === undefined);
}

export const applicationsAvailable = applicationFeaturesEnabled(
  import.meta.env.DEV,
  import.meta.env.VITE_LT_APPLICATIONS_ENABLED,
);

export const unavailableMessage = "登壇申請・メール確認は現在利用できません。";

/** 閲覧専用公開で表示できるページを固定する */
export function isPublicPage(path: string): boolean {
  return path === "/" || /^\/events\/[^/]+(?:\/talks\/[^/]+)?\/?$/.test(path);
}
