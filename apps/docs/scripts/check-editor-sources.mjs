import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { documents, validateFile, validateNavigation, navigationLinks, markdownImages } from '../editor-policy.mjs';
import { MAX_IMAGE_BYTES, imageFormat, imageBlobSha, uploadedImage } from '../editor-images.mjs';
const root = resolve(import.meta.dirname, '../../..');
const nav = validateNavigation(JSON.parse(await readFile(resolve(root, 'docs/navigation.json'), 'utf8')));
const paths = new Set(Object.values(documents).filter(doc => doc.path).map(doc => doc.path));
const referencedImages = new Set();
// Only the explicitly supported new-page folder participates; archives are never discovered.
for (const entry of await readdir(resolve(root, 'docs/guide'))) if (/^[a-z0-9-]+\.md$/.test(entry)) paths.add(`docs/guide/${entry}`);
for (const path of paths) {
  const info = await lstat(resolve(root, path));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${path}: only regular documents are supported`);
  try {
    const source = await readFile(resolve(root, path), 'utf8');
    validateFile(path, source);
    for (const image of markdownImages(source)) referencedImages.add(image.url);
  } catch (error) { throw new Error(`${path}: ${error.message}`); }
}

// Validate uploaded assets and reject missing images before producing a public build
const directory = resolve(root, 'docs/public/images/uploads');
let entries = [];
try {
  for (const path of ['docs/public', 'docs/public/images', 'docs/public/images/uploads']) {
    const info = await lstat(resolve(root, path));
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${path}: only regular directories are supported`);
  }
  entries = await readdir(directory);
} catch (error) { if (error.code !== 'ENOENT') throw error; }

for (const name of entries) {
  const image = uploadedImage(`/images/uploads/${name}`), path = resolve(directory, name);
  const info = await lstat(path);
  if (!image || !info.isFile() || info.isSymbolicLink() || info.size > MAX_IMAGE_BYTES) throw new Error(`${path}: invalid uploaded image`);
  const bytes = new Uint8Array(await readFile(path));
  if (imageFormat(bytes) !== image.extension || await imageBlobSha(bytes) !== image.sha) throw new Error(`${path}: image content does not match its URL`);
  referencedImages.delete(image.url);
}
if (referencedImages.size) throw new Error(`Missing uploaded images: ${[...referencedImages].join(', ')}`);
for (const link of navigationLinks(nav)) {
  const route = link.split('#')[0];
  if (!Object.values(documents).some(doc => doc.route === route) && !paths.has(`docs${route}.md`)) throw new Error(`Missing navigation destination: ${route}`);
}
console.log(`Validated ${paths.size} editable Markdown sources and navigation.`);
