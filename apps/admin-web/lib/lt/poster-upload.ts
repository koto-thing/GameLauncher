export const MAX_POSTER_BYTES = 5 * 1024 * 1024;

/** @brief 実ファイルの識別子から許可画像の種類を判定する */
export function posterType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP") return "image/webp";
  return null;
}

/** @brief ストリームの読み込み中もアップロード容量を制限する */
export async function readPoster(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > MAX_POSTER_BYTES) throw new Response("画像は5MB以下にしてください", {status:413});
  if (!request.body) throw new Response("画像を選択してください", {status:400});
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const {value,done} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_POSTER_BYTES) { await reader.cancel(); throw new Response("画像は5MB以下にしてください", {status:413}); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return bytes;
}
