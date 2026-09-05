import { timingSafeEqual } from "node:crypto";

/** @brief URLとCookieへ安全に入る暗号学的乱数を生成する。 @returns 256bitトークン。 */
export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}
/** @brief DBにBearerトークンの原文を保存しないためSHA-256を使う。 @param value トークン。 */
export async function hashToken(value: string): Promise<string> {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).toString("base64url");
}
/** @brief stateとCSRF値を定時間比較する。 */
export function equalToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
