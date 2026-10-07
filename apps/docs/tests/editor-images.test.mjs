import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MAX_IMAGE_BYTES, imageFormat, imageBlobSha, imageMarkdown, uploadedImage } from '../editor-images.mjs';
import { markdownImages, validateMarkdown } from '../editor-policy.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('image URLs match actual Git blob hashes and reject paths or executable formats', async () => {
  const sha = await imageBlobSha(png);
  assert.equal(sha, createHash('sha1').update(`blob ${png.length}\0`).update(png).digest('hex'));
  assert.equal(imageFormat(png), 'png');
  assert.equal(uploadedImage(`/images/uploads/${sha}.png`).path, `docs/public/images/uploads/${sha}.png`);
  for (const path of [`/images/uploads/${sha}.svg`, `/images/uploads/../${sha}.png`, `/images/uploads/${sha}.png?x`, `https://example.com/images/uploads/${sha}.png`]) assert.equal(uploadedImage(path), null);
  for (const bytes of [new Uint8Array(), new Uint8Array(MAX_IMAGE_BYTES + 1), Buffer.from('<svg></svg>'), png.subarray(0, 8)]) assert.throws(() => imageFormat(bytes));
});

test('Markdown image references deduplicate and ignore fenced and inline examples', async () => {
  const url = `/images/uploads/${await imageBlobSha(png)}.png`;
  const image = imageMarkdown('日本語 [画面](1).png', url);
  const source = `${image}\n\n${image}\n\n\`${image}\`\n\n\`\`\`md\n${image}\n\`\`\`\n`;
  validateMarkdown(source);
  assert.equal(markdownImages(source).length, 1);
  assert.equal(markdownImages(`\`${image}\`\n\n\`\`\`md\n${image}\n\`\`\``).length, 0);
  assert.throws(() => validateMarkdown('![remote](https://example.com/image.png)'));
  assert.throws(() => validateMarkdown(Array.from({ length: 11 }, (_, i) => `![img](/images/uploads/${i.toString(16).padStart(40, '0')}.png)`).join('\n')));
});
