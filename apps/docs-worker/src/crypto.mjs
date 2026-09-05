const encoder = new TextEncoder();
export function base64(bytes) { return btoa(String.fromCharCode(...bytes)); }
export function unbase64(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export function random() { return base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
export async function hash(value) { return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
async function key(secret) { const bytes = unbase64(secret); if (bytes.length !== 32) throw new Error('Invalid encryption key'); return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }
export async function encrypt(value, secret, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, await key(secret), encoder.encode(value));
  return `${base64(iv)}.${base64(new Uint8Array(bytes))}`;
}
export async function decrypt(value, secret, context) {
  const [iv, bytes] = value.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv), additionalData: encoder.encode(context) }, await key(secret), unbase64(bytes)));
}
export async function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bytesA = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(a)));
  const bytesB = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(b)));
  let difference = 0; for (let i = 0; i < bytesA.length; i++) difference |= bytesA[i] ^ bytesB[i]; return difference === 0;
}
