export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export function ensure(ok, status, message, details) { if (!ok) throw new ApiError(status, message, details); }
export async function boundedJson(request, maximum = 210000) {
  ensure(request.headers.get('content-type')?.split(';')[0] === 'application/json', 422, 'JSON形式で送信してください。');
  const reader = request.body?.getReader(); ensure(reader, 422, '入力がありません。');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length; if (size > maximum) { await reader.cancel(); throw new ApiError(413, '入力サイズが上限を超えています。'); } chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ApiError(422, 'JSONが不正です。'); }
}
export async function rateLimit(db, key, limit = 20) {
  const window = Math.floor(Date.now() / 60000);
  const result = await db.prepare('INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END, window=excluded.window RETURNING count').bind(key, window).first();
  ensure(result.count <= limit, 429, '操作が多すぎます。1分後に再試行してください。');
}
export function json(value, status = 200) { return Response.json(value, { status }); }
