/**
 * 同じ操作内容の再送で使う ID と、成功後の破棄処理を用意する
 *
 * @param key 操作の種類と対象を識別するキー
 * @param payload 同一性を判定する JSON 化可能な操作内容
 * @returns 操作 ID と、保存した ID を削除する complete 関数
 */
export async function operation(key: string, payload: unknown) {
  // 本文・メール・トークンを保存せず、操作内容の指紋だけを作る
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key + JSON.stringify(payload)),
  );
  const fingerprint =
    "lt.operation." +
    Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

  // 未完了の同じ操作には保存済みの ID を再利用する
  let id = sessionStorage.getItem(fingerprint);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(fingerprint, id);
  }

  // 呼出元が成功を確認した後にだけ ID を破棄する
  return { id, complete: () => sessionStorage.removeItem(fingerprint) };
}
