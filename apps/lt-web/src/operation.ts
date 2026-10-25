// 結果不明の再送は同じ operationId を使い、payload 変更時だけ新規発行する
const pending = new Map<string, string>();
export function operation(key: string, payload: unknown) {
  const fingerprint = key + JSON.stringify(payload);
  let id = pending.get(fingerprint);
  if (!id) {
    id = crypto.randomUUID();
    pending.set(fingerprint, id);
  }
  return { id, complete: () => pending.delete(fingerprint) };
}
