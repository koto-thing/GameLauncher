// 永続化するのは SHA-256 指紋とランダム ID のみ。本文・メール・token は保存しない
export async function operation(key: string, payload: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key + JSON.stringify(payload)),
  );
  const fingerprint =
    "lt.operation." +
    Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  let id = sessionStorage.getItem(fingerprint);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(fingerprint, id);
  }
  return { id, complete: () => sessionStorage.removeItem(fingerprint) };
}
