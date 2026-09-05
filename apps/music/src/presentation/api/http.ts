import { MusicError } from "../../domain/models";

/** @brief 小さな管理JSONも実測の本文上限を強制する。 */
export async function readJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new MusicError("INVALID", "JSON形式で送信してください。");
  const reader = request.body?.getReader();
  if (!reader) throw new MusicError("INVALID", "入力本文がありません。");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new MusicError("TOO_LARGE", "入力が大きすぎます。");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data)) as unknown;
  } catch {
    throw new MusicError("INVALID", "JSONが不正です。");
  }
}
/** @brief 単一区間のHTTP Rangeを正規化する。 @returns nullは全体、falseは416。 */
export function byteRange(
  header: string | null,
  size: number,
): { offset: number; length: number } | null | false {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return false;
  if (!match[1]) {
    const length = Number(match[2]);
    return Number.isSafeInteger(length) && length > 0
      ? { offset: Math.max(0, size - length), length: Math.min(size, length) }
      : false;
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start < size &&
    start <= end
    ? { offset: start, length: end - start + 1 }
    : false;
}
