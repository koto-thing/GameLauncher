import { MAX_IMAGE_BYTES, MAX_IMAGES, imageFormat, imageBlobSha, uploadedImage } from '../../docs/editor-images.mjs';
import { markdownImages } from '../../docs/editor-policy.mjs';
import { ApiError, ensure, boundedBytes, rateLimit } from './http.mjs';
import { REPO, regularFile } from './github.mjs';

// Translate shared image policy failures into actionable API errors
function format(bytes) {
  try { return imageFormat(bytes); } catch (error) { throw new ApiError(422, error.message); }
}

// Upload immutable image bytes without changing any branch or publishing a page
export async function uploadImage(request, env, current) {
  await rateLimit(env.DOCS_DB, `upload:${current.user_id}`, 20);
  const bytes = await boundedBytes(request, MAX_IMAGE_BYTES);
  const extension = format(bytes);
  const sha = await imageBlobSha(bytes);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));

  const blob = await current.api(`${REPO}/git/blobs`, 'POST', { content: btoa(binary), encoding: 'base64' });
  ensure(blob.sha === sha, 502, 'アップロードした画像の照合に失敗しました。');
  return { url: `/images/uploads/${sha}.${extension}` };
}

// Revalidate binary data when it is previewed, saved, or published
export async function readImage(api, image) {
  const blob = await api(`${REPO}/git/blobs/${image.sha}`);
  ensure(blob.encoding === 'base64' && blob.size > 0 && blob.size <= MAX_IMAGE_BYTES, 413, '画像は1枚2MiBまでです。');
  let bytes;
  try { bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), c => c.charCodeAt(0)); } catch { throw new ApiError(422, '画像データが不正です。'); }

  ensure(bytes.length === blob.size && format(bytes) === image.extension && await imageBlobSha(bytes) === image.sha, 422, '画像の内容・形式がURLと一致しません。');
  return bytes;
}

// Resolve referenced images into the same tree as the document, rejecting unsafe parents
export async function resolveImages(api, snapshot, files) {
  const images = new Map(files.filter(file => file.path.endsWith('.md')).flatMap(file => markdownImages(file.content)).map(image => [image.path, image]));
  ensure(images.size <= MAX_IMAGES, 422, '1変更のアップロード画像は10枚までです。');
  const additions = [];
  for (const image of images.values()) {
    const parts = image.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = snapshot.entries.get(parts.slice(0, i).join('/'));
      ensure(!parent || (parent.type === 'tree' && parent.mode === '040000'), 422, '画像の親パスが通常のディレクトリではありません。');
    }
    if (snapshot.entries.has(image.path)) {
      ensure(regularFile(snapshot.entries, image.path).sha === image.sha, 422, '保存済み画像の内容がURLと一致しません。');
    } else additions.push(image);
    try { await readImage(api, image); } catch (error) {
      if (error.status === 404) throw new ApiError(422, '参照する画像が見つかりません。画像を再アップロードしてください。');
      throw error;
    }
  }
  return additions;
}

// Recognize the sole directory in which editor uploads may be committed
export function imageAtPath(path) {
  return path.startsWith('docs/public/') ? uploadedImage(path.slice('docs/public'.length)) : null;
}
