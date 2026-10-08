import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';
import { page, save, publish } from '../src/changes.mjs';
import { uploadImage, readImage, resolveImages } from '../src/images.mjs';
import { REPO, tree } from '../src/github.mjs';
import { imageBlobSha, MAX_IMAGE_BYTES, uploadedImage } from '../../docs/editor-images.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

// Send real binary request bodies through the existing authenticated API route
function request(f, bytes = png, headers = {}) {
  const base = f.request('/images', 'POST', undefined, { 'Content-Type': 'application/octet-stream', ...headers });
  return new Request(base, { body: bytes });
}

// Exercise the production GitHub wrapper while keeping all writes in the fixture
function mockGitHub(t, f) {
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    try {
      return Response.json(await f.gh.api(new URL(url).pathname + new URL(url).search, options.method || 'GET', options.body ? JSON.parse(options.body) : undefined));
    } catch (error) { return Response.json({}, { status: error.status || 502 }); }
  });
}

test('binary upload, authenticated preview, save and publish preserve identical image bytes', async t => {
  const f = await fixture(); mockGitHub(t, f);
  const response = await f.worker.fetch(request(f), f.env);
  assert.equal(response.status, 201);
  const { url } = await response.json(), image = uploadedImage(url);
  assert.equal(image.sha, await imageBlobSha(png));
  assert.equal(f.gh.refs.size, 1); assert.equal(f.gh.prs.length, 0);
  const preview = await f.worker.fetch(f.request(`/images/${image.sha}.png`), f.env);
  assert.equal(preview.headers.get('Content-Type'), 'image/png');
  assert.equal(preview.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), png);

  const doc = await page(f.gh.api, 'guide/index');
  const input = { key: crypto.randomUUID(), head: doc.head, files: [{ documentId: 'guide/index', sha: doc.sha, content: `# 画像付き原稿\n\n![画面](${url})\n` }] };
  f.gh.cutRef = true;
  await assert.rejects(save(f.env, f.session, input));
  const result = await save(f.env, f.session, input);
  assert.equal(f.gh.files(f.gh.prs[0]).length, 2);
  assert.deepEqual(Buffer.from(await readImage(f.gh.api, image)), png);
  assert.equal((await page(f.gh.api, 'guide/index', f.gh.refs.get(f.gh.prs[0].branch))).content, input.files[0].content);
  assert.equal((await publish(f.env, f.session, result.id, result.head)).state, 'publishing');
});

test('upload authentication, CSRF, Origin and collaborator rights are enforced before writing blobs', async t => {
  const f = await fixture(); mockGitHub(t, f);
  for (const [headers, status] of [[{ Cookie: '' }, 401], [{ 'X-CSRF-Token': '' }, 403], [{ 'X-CSRF-Token': 'bad' }, 403], [{ Origin: '' }, 403], [{ Origin: 'https://other.test' }, 403]]) {
    assert.equal((await f.worker.fetch(request(f, png, headers), f.env)).status, status);
  }
  f.gh.permission = 'read';
  assert.equal((await f.worker.fetch(request(f), f.env)).status, 403);
  assert.equal(f.gh.calls.filter(call => call.method !== 'GET').length, 0);
});

test('binary bodies are exclusive to image uploads and unsupported media types never cause writes', async t => {
  const f = await fixture(); mockGitHub(t, f);
  for (const type of ['', 'text/plain', 'multipart/form-data', 'application/json']) {
    const result = await f.worker.fetch(request(f, png, { 'Content-Type': type }), f.env);
    assert.equal(result.status, 422);
    assert.match((await result.json()).error, /バイナリ形式/);
  }
  for (const [path, method] of [['/changes', 'POST'], ['/changes/00000000-0000-4000-8000-000000000001', 'PATCH'], ['/changes/00000000-0000-4000-8000-000000000001/publish', 'POST'], ['/logout', 'POST']]) {
    for (const type of ['application/octet-stream', 'text/plain', '']) {
      const result = await f.worker.fetch(f.request(path, method, {}, { 'Content-Type': type }), f.env);
      assert.equal(result.status, 422);
      assert.match((await result.json()).error, /JSON形式/);
    }
  }
  assert.equal(f.gh.calls.filter(call => call.method !== 'GET').length, 0);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM sessions').first()).n, 1);
});

test('reject oversized or disguised uploads and previews of non-image blobs', async t => {
  const f = await fixture(); mockGitHub(t, f);
  assert.equal((await f.worker.fetch(request(f, new Uint8Array(MAX_IMAGE_BYTES + 1)), f.env)).status, 413);
  assert.equal((await f.worker.fetch(request(f, Buffer.from('<svg onload="bad"/>')), f.env)).status, 422);
  const sha = f.gh.addBlob('# document');
  assert.equal((await f.worker.fetch(f.request(`/images/${sha}.png`), f.env)).status, 422);
  assert.equal(f.gh.calls.filter(call => call.method !== 'GET').length, 0);
});

test('new page, navigation and several images are committed and published together', async () => {
  const f = await fixture(), doc = await page(f.gh.api, '$navigation');
  const urls = [];
  for (let i = 0; i < 4; i++) urls.push((await uploadImage(request(f, Buffer.concat([png, Buffer.from([i])])), f.env, f.session)).url);
  const nav = JSON.parse(doc.content); nav.sidebar['/guide/'][0].items.push({ text: '画像', link: '/guide/images' });
  const saved = await save(f.env, f.session, { key: crypto.randomUUID(), head: doc.head, files: [
    { documentId: 'guide/images', create: true, content: '# 画像\n\n' + urls.map(url => `![画像](${url})`).join('\n\n') },
    { documentId: '$navigation', sha: doc.sha, content: JSON.stringify(nav) }
  ] });
  assert.equal(f.gh.files(f.gh.prs[0]).length, 6);
  assert.equal((await publish(f.env, f.session, saved.id, saved.head)).state, 'publishing');
});

test('missing images, extension mismatches, symlink parents and tampered image paths prevent saves', async () => {
  const f = await fixture(), doc = await page(f.gh.api, 'guide/index');
  const { url } = await uploadImage(request(f), f.env, f.session), image = uploadedImage(url);
  const input = url => ({ key: crypto.randomUUID(), head: doc.head, files: [{ documentId: 'guide/index', sha: doc.sha, content: `![画像](${url})` }] });
  await assert.rejects(save(f.env, f.session, input(url.replace('.png', '.jpg'))), { status: 422 });
  await assert.rejects(save(f.env, f.session, input(`/images/uploads/${'a'.repeat(40)}.png`)), error => error.status === 422 && error.details.discardOperation);
  const snapshot = await tree(f.gh.api, doc.head);
  snapshot.entries.set('docs/public', { type: 'blob', mode: '120000' });
  await assert.rejects(resolveImages(f.gh.api, snapshot, [{ path: doc.path, content: `![](${url})` }]), { status: 422 });
  snapshot.entries.set('docs/public', { type: 'tree', mode: '040000' });
  snapshot.entries.set('docs/public/images', { type: 'tree', mode: '040000' });
  snapshot.entries.set('docs/public/images/uploads', { type: 'tree', mode: '040000' });
  snapshot.entries.set(image.path, { type: 'blob', mode: '100644', sha: 'b'.repeat(40) });
  await assert.rejects(resolveImages(f.gh.api, snapshot, [{ path: doc.path, content: `![](${url})` }]), { status: 422 });
  assert.equal(f.gh.calls.filter(call => call.path === `${REPO}/git/commits` && call.method === 'POST').length, 0);
});
