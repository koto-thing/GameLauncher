import assert from 'node:assert/strict';
import test from 'node:test';
import { posterType, readPoster, MAX_POSTER_BYTES } from '../lib/lt/poster-upload.ts';

// 拡張子ではなくバイナリで画像形式を確認する
test('poster signatures reject HTML and SVG', () => {
  assert.equal(posterType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(posterType(new TextEncoder().encode('<html>not an image</html>')), null);
  assert.equal(posterType(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])), 'image/png');
  assert.equal(posterType(new Uint8Array([255,216,255,0,0,0,0,0,0,0,0,0])), 'image/jpeg');
  assert.equal(posterType(new TextEncoder().encode('RIFF0000WEBP')), 'image/webp');
});

// Content-Lengthがない分割送信にも上限を強制する
test('poster stream enforces size limit', async () => {
  const body = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(MAX_POSTER_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close();}});
  const request = new Request('https://example.com',{method:'POST',body,duplex:'half'});
  await assert.rejects(readPoster(request), error => error instanceof Response && error.status === 413);
});
