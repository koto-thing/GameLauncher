export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES = 10;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const imagePattern = /^\/images\/uploads\/([0-9a-f]{40})\.(png|jpg|gif|webp)$/;
const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

// Parse only content-addressed raster image URLs managed by the editor
export function uploadedImage(url) {
  const match = imagePattern.exec(url);
  return match ? { url, sha: match[1], extension: match[2], type: mimeTypes[match[2]], path: `docs/public${url}` } : null;
}

// Check the size and file signature instead of trusting a filename or MIME header
export function imageFormat(bytes) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('画像は1枚2MiBまでです。');

  const starts = values => values.every((value, i) => bytes[i] === value);
  const text = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
  if (bytes.length >= 24 && starts([137, 80, 78, 71, 13, 10, 26, 10]) && text(12, 16) === 'IHDR') return 'png';
  if (bytes.length >= 4 && starts([255, 216, 255]) && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return 'jpg';
  if (bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(text(0, 6)) && bytes[bytes.length - 1] === 59) return 'gif';
  if (bytes.length >= 20 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(text(12, 16))) return 'webp';
  throw new Error('PNG・JPEG・GIF・WebPの画像を選んでください。');
}

// Compute the Git blob ID so an image URL can never refer to different bytes
export async function imageBlobSha(bytes) {
  const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const content = new Uint8Array(prefix.length + bytes.length);
  content.set(prefix); content.set(bytes, prefix.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', content)), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Escape punctuation in filenames before using them as Markdown alt text
export function imageMarkdown(name, url) {
  if (!uploadedImage(url)) throw new Error('アップロード結果の画像URLが不正です。');
  const label = name.replace(/\.[^.]+$/, '').replace(/[\x00-\x1f\x7f{}<>]/g, ' ').replace(/[\\`*_[\]()!#&]/g, '\\$&');
  return `![${label || '画像'}](${url})`;
}
