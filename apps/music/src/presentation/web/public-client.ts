/** @brief レンタルサーバーの同一origin公開データだけを読む。 @param path 公開読取path。 @returns 公開DTO。 */
export async function publicApi<T>(path: string): Promise<T> {
  if (!path.startsWith("/public/")) throw new Error("公開APIの範囲外です。");
  const response = await fetch(`${import.meta.env.BASE_URL}api${path}`, {
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error("公開情報を取得できません。再読込してください。");
  return response.json() as Promise<T>;
}
/** @brief 公開mediaをレンタルサーバー内のURLに限定する。 @param id サーバー生成Asset ID。 @returns 同一originのmedia URL。 */
export function publicAssetUrl(id: string): string {
  return `${import.meta.env.BASE_URL}api/assets/${encodeURIComponent(id)}`;
}
