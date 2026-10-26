/**
 * 本番では明示設定がある場合だけ申請機能を表示する
 *
 * @param development 開発環境の場合は true
 * @param configured 環境変数の設定値、未設定の場合は undefined
 * @returns 申請機能を有効にする場合は true
 */
export function applicationFeaturesEnabled(development: boolean, configured?: string): boolean {
  return configured === "true" || (development && configured === undefined);
}

export const applicationsAvailable = applicationFeaturesEnabled(
  import.meta.env.DEV,
  import.meta.env.VITE_LT_APPLICATIONS_ENABLED,
);

export const unavailableMessage = "登壇申請・メール確認は現在利用できません。";

/**
 * 閲覧専用公開で表示できるページか判定する
 *
 * @param path クエリを除いたページのパス
 * @returns 開催回一覧・詳細・発表詳細の場合は true
 */
export function isPublicPage(path: string): boolean {
  return path === "/" || /^\/events\/[^/]+(?:\/talks\/[^/]+)?\/?$/.test(path);
}
