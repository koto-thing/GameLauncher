export const PRODUCTION_ORIGIN = "https://downloads.koto-thing.com";

export type EditionDefinition = {
  schemaVersion: 1;
  id: string;
  name: string;
  accentColor: string;
  games: string[];
};

/** @brief 永続化前に固定配布版の入力を検証する */
export function validateEdition(input: unknown, id: string): EditionDefinition {
  const value = input as Partial<EditionDefinition> | null;
  if (!value || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 ||
      typeof value.accentColor !== "string" || !/^#[a-fA-F0-9]{6}$/.test(value.accentColor) ||
      !Array.isArray(value.games) || !value.games.length || value.games.length > 50 ||
      value.games.some((game) => typeof game !== "string" || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(game)) ||
      new Set(value.games).size !== value.games.length) {
    throw new Error("配布版名、色、重複のない収録ゲームを指定してください（最大50本）");
  }
  return { schemaVersion: 1, id, name: value.name.trim(), accentColor: value.accentColor, games: value.games };
}

/** @brief 本番の固定配信元だけを許可する */
export function productionUrl(value: string): string {
  const url = new URL(value);
  if (url.origin !== PRODUCTION_ORIGIN || url.username || url.password || url.hash || url.search ||
      !url.pathname.startsWith("/v1/")) throw new Error("本番配信元以外のURLです");
  return url.href;
}

/** @brief PNGヘッダーと寸法・容量を検証する */
export function validateEditionImage(bytes: Uint8Array): void {
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || bytes.length > 2 * 1024 * 1024 || png.some((byte, i) => bytes[i] !== byte)) {
    throw new Error("画像は2 MiB以下のPNGを指定してください");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 4096 || height > 4096) throw new Error("画像は4096×4096以内にしてください");
}
