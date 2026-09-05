import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';
import { authorize, regularFile, github, REPO, REPOSITORY_ID } from '../src/github.mjs';
import { page, save, publish, readiness, status, owned } from '../src/changes.mjs';
import { session, start, callback, returnTo } from '../src/auth.mjs';
import { encrypt, decrypt, random, hash } from '../src/crypto.mjs';
import { boundedJson } from '../src/http.mjs';
async function input(f, source = '# 日本語の編集\n\n本文です。\n') { const doc = await page(f.gh.api, 'guide/index'); return { key: crypto.randomUUID(), head: doc.head, files: [{ documentId: 'guide/index', content: source, sha: doc.sha }] }; }

test('a non-owner write collaborator saves, verifies content, and publishes using expected SHA', async () => {
  const f = await fixture(), body = await input(f), result = await save(f.env, f.session, body);
  assert.equal(f.gh.prs.length, 1); assert.equal(result.state, 'saved');
  const actual = await page(f.gh.api, 'guide/index', f.gh.prs[0].branch); assert.equal(actual.content, body.files[0].content);
  assert.equal((await readiness(f.gh.api, await owned(f.db, result.id, 42))).state, 'ready');
  const merged = await publish(f.env, f.session, result.id, result.head); assert.equal(merged.state, 'publishing');
  const call = f.gh.calls.find(call => call.path.endsWith('/merge')); assert.equal(call.body.sha, result.head); assert.equal(call.body.merge_method, 'squash');
  f.gh.published = merged.mergeSha; assert.equal((await status(f.env, f.session, result.id)).state, 'published');
  f.gh.comparison = 'ahead'; f.gh.published = 'a'.repeat(40); assert.equal((await status(f.env, f.session, result.id)).state, 'published');
});
test('new page and navigation are a single commit', async () => {
  const f = await fixture(), doc = await page(f.gh.api, '$navigation'), nav = JSON.parse(doc.content); nav.sidebar['/guide/'][0].items.push({ text: '追加', link: '/guide/new-page' });
  await save(f.env, f.session, { key: crypto.randomUUID(), head: doc.head, files: [{ documentId: 'guide/new-page', create: true, content: '# 新規\n' }, { documentId: '$navigation', content: JSON.stringify(nav), sha: doc.sha }] });
  assert.equal(f.gh.calls.filter(c => c.method === 'POST' && c.path.endsWith('/git/commits')).length, 1);
  assert.equal(f.gh.files(f.gh.prs[0]).length, 2);
});
test('updates an owned PR and does not create a second PR', async () => {
  const f = await fixture(), body = await input(f), first = await save(f.env, f.session, body);
  const latest = await page(f.gh.api, 'guide/index', f.gh.prs[0].branch);
  const second = await save(f.env, f.session, { key: crypto.randomUUID(), head: first.head, files: [{ documentId: 'guide/index', sha: latest.sha, content: '# 二回目\n' }] }, first.id);
  assert.notEqual(second.head, first.head); assert.equal(f.gh.prs.length, 1);
  await assert.rejects(save(f.env, f.session, { ...body, key: crypto.randomUUID() }, first.id), { status: 409 });
});
for (const fault of ['cutRef','cutPr']) test(`reconciles a lost ${fault} response without duplicate commits or PRs`, async () => {
  const f = await fixture(), body = await input(f); f.gh[fault] = true;
  await assert.rejects(save(f.env, f.session, body)); const result = await save(f.env, f.session, body); await save(f.env, f.session, body);
  assert.equal(f.gh.prs.length, 1); assert.equal(f.gh.calls.filter(c => c.method === 'POST' && c.path.endsWith('/git/commits')).length, 1); assert.equal(result.state, 'saved');
});
test('reconciles a lost merge response without merging twice', async () => {
  const f = await fixture(), result = await save(f.env, f.session, await input(f)); f.gh.cutMerge = true;
  await assert.rejects(publish(f.env, f.session, result.id, result.head)); assert.equal((await publish(f.env, f.session, result.id, result.head)).state, 'publishing');
  assert.equal(f.gh.calls.filter(c => c.path.endsWith('/merge')).length, 1);
});
test('rejects concurrent save clicks with a lock, retry succeeds once', async () => {
  const f = await fixture(), body = await input(f);
  const results = await Promise.allSettled([save(f.env, f.session, body),save(f.env, f.session, body)]);
  assert.ok(results.some(r => r.status === 'fulfilled')); assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 409)); assert.equal(f.gh.prs.length, 1);
  await save(f.env, f.session, body); assert.equal(f.gh.prs.length, 1);
});
for (const permission of ['read','triage','none']) test(`denies ${permission} collaborators and revoked privileges`, async () => {
  const f = await fixture(), body = await input(f); f.gh.permission = permission;
  await assert.rejects(save(f.env, f.session, body), { status: 403 }); assert.equal(f.gh.prs.length, 0);
});
test('denies wrong user ID, inaccessible App repository, and repository substitution', async () => {
  const f = await fixture(); await assert.rejects(authorize(f.gh.api, 999), { status: 403 });
  f.gh.push = false; await assert.rejects(authorize(f.gh.api, 42), { status: 403 }); f.gh.push = true;
  f.gh.repoId = 1; await assert.rejects(authorize(f.gh.api, 42), { status: 403 });
});
for (const state of ['failure','pending','cancelled']) test(`never merges when CI is ${state}`, async () => {
  const f = await fixture(), result = await save(f.env, f.session, await input(f)); f.gh.ci = state;
  await assert.rejects(publish(f.env, f.session, result.id, result.head), { status: 409 }); assert.equal(f.gh.prs[0].merged, false);
});
test('requires exact workflow head, verified base, approvals and expected head', async () => {
  const f = await fixture(), result = await save(f.env, f.session, await input(f));
  f.gh.ciHead = 'a'.repeat(40); await assert.rejects(publish(f.env, f.session, result.id, result.head), { status: 409 }); f.gh.ciHead = null;
  f.gh.ciBase = 'b'.repeat(40); await assert.rejects(publish(f.env, f.session, result.id, result.head), { status: 409 }); f.gh.ciBase = null;
  f.gh.mergeableState = 'blocked'; await assert.rejects(publish(f.env, f.session, result.id, result.head), { status: 409 }); f.gh.mergeableState = 'clean';
  await assert.rejects(publish(f.env, f.session, result.id, 'c'.repeat(40)), { status: 409 });
  f.gh.refs.set('master', 'b'.repeat(40)); await assert.rejects(publish(f.env, f.session, result.id, result.head), { status: 409 });
});
test('denies other users changes and arbitrary refs/document IDs', async () => {
  const f = await fixture(), result = await save(f.env, f.session, await input(f));
  await assert.rejects(owned(f.db, result.id, 99), { status: 404 });
  await assert.rejects(page(f.gh.api, '../.github/workflows/ci')); await assert.rejects(page(f.gh.api, 'guide%2findex'));
});
test('rejects symlinks, submodules, executable modes, and symlink parents', () => {
  for (const [mode, type] of [['120000','blob'],['160000','commit'],['100755','blob']]) assert.throws(() => regularFile(new Map([['docs',{mode:'040000',type:'tree'}],['docs/a.md',{mode,type}]]), 'docs/a.md'), { status: 422 });
  assert.throws(() => regularFile(new Map([['docs',{mode:'120000',type:'blob'}]]), 'docs/a.md', true), { status: 422 });
});
test('rejects modified PR heads, code injection and incomplete diffs', async () => {
  const f = await fixture(), result = await save(f.env, f.session, await input(f));
  f.gh.extraFiles = [{ filename: '.github/workflows/ci.yml', status: 'modified' }];
  await assert.rejects(publish(f.env, f.session, result.id, result.head), { status: 422 }); f.gh.extraFiles = [];
  await assert.rejects(publish(f.env, f.session, result.id, result.head), { status: 422 });
  f.gh.refs.set(f.gh.prs[0].branch, f.gh.base); await assert.rejects(publish(f.env, f.session, result.id, result.head), { status: 409 });
});
test('stale blob and base never overwrite current content', async () => {
  const f = await fixture(), body = await input(f); body.files[0].sha = 'a'.repeat(40);
  await assert.rejects(save(f.env, f.session, body), { status: 409 }); assert.equal(f.gh.prs.length, 0);
});
test('session CSRF, Origin, expiry, cookie tampering and encryption binding', async () => {
  const f = await fixture(); assert.equal((await session(f.request('/changes','POST',{}), f.env, true)).user_id, 42);
  for (const headers of [{Origin:'https://evil.test'}, {'X-CSRF-Token':'bad'}, {'Content-Type':'text/plain'}]) await assert.rejects(session(f.request('/changes','POST',{},headers), f.env, true), { status: 403 });
  await assert.rejects(session(f.request('/session','GET',undefined,{Cookie:'__Host-pandd_docs_session=tampered'}), f.env), { status: 401 });
  await f.db.prepare('UPDATE sessions SET expires_at=0').run(); await assert.rejects(session(f.request('/session'), f.env), { status: 401 });
  const token = await encrypt('secret', f.env.DOCS_TOKEN_KEY, 'user:1'); assert.equal(await decrypt(token, f.env.DOCS_TOKEN_KEY, 'user:1'), 'secret'); await assert.rejects(decrypt(token, f.env.DOCS_TOKEN_KEY, 'user:2'));
});
test('PKCE start binds one-time state, cookie and fixed callback; rejects external returnTo', async () => {
  const f = await fixture(), response = await start(f.request('/auth/start?returnTo=/editor?documentId=guide/index'), f.env), url = new URL(response.headers.get('Location'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('redirect_uri'), f.env.DOCS_ORIGIN + '/api/docs/auth/callback');
  assert.equal(url.searchParams.get('code_challenge').length, 43);
  for (const path of ['https://evil.test','//evil.test','/editor%253f','/editor?documentId=../secret','/editor?documentId=%2f%2f']) assert.throws(() => returnTo(path));
  await assert.rejects(callback(f.request('/auth/callback?code=test&state=' + random()), f.env), { status: 401 });
  const rawCookie = response.headers.get('Set-Cookie').split(';')[0];
  await f.db.prepare('UPDATE oauth_attempts SET expires_at=0').run();
  await assert.rejects(callback(f.request('/auth/callback?code=test&state=' + url.searchParams.get('state'), 'GET', undefined, {Cookie: rawCookie}), f.env), { status: 401 });
});
for (const tokenSeconds of [28800, 3600]) test(`OAuth callback binds state and limits session lifetime to six hours or token expiry (${tokenSeconds}s)`, async t => {
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = await fixture(), begun = await start(f.request('/auth/start'), f.env), url = new URL(begun.headers.get('Location'));
  const headers = { Cookie: begun.headers.get('Set-Cookie').split(';')[0] }, state = url.searchParams.get('state');
  t.mock.method(globalThis, 'fetch', async (target, options) => {
    if (String(target).includes('/login/oauth/access_token')) {
      assert.equal(options.body.get('repository_id'), String(REPOSITORY_ID)); assert.equal(await hash(options.body.get('code_verifier')), url.searchParams.get('code_challenge'));
      return Response.json({access_token:'ghu_fixture',expires_in:tokenSeconds,refresh_token:'never-store-this'});
    }
    return Response.json(await f.gh.api(new URL(target).pathname));
  });
  const request = f.request(`/auth/callback?code=test&state=${state}`, 'GET', undefined, headers);
  const result = await callback(request, f.env); assert.equal(result.status, 302); assert.match(result.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  await assert.rejects(callback(request, f.env), { status: 401 });
  assert.ok(!JSON.stringify(f.db.sqlite.prepare('SELECT * FROM sessions').all()).includes('never-store-this'));
  const seconds = Math.min(21600, tokenSeconds);
  const sessionCookie = result.headers.getSetCookie()[0];
  assert.ok(sessionCookie.endsWith(`Max-Age=${seconds}`));
  const sessionRequest = f.request('/session', 'GET', undefined, { Cookie: sessionCookie.split(';')[0] });
  assert.equal((await session(sessionRequest, f.env)).expires_at, now + seconds * 1000);
  t.mock.method(Date, 'now', () => now + seconds * 1000 - 1);
  assert.equal((await session(sessionRequest, f.env)).user_id, 42);
  t.mock.method(Date, 'now', () => now + seconds * 1000);
  await assert.rejects(session(sessionRequest, f.env), { status: 401 });
});
for (const [response, status, message] of [
  [{ error: 'bad_verification_code' }, 401, /認証コード/],
  [{ error: 'incorrect_client_credentials' }, 503, /Client IDまたはClient secret/],
  [{ error: 'redirect_uri_mismatch' }, 503, /Callback URL/],
  [{ error: 'unknown-provider-error', error_description: 'secret-value' }, 502, /認証を拒否/],
  [{ access_token: 'ghu_fixture' }, 503, /User-to-server token expiration/],
  [{ access_token: 'gho_fixture', expires_in: 28800 }, 502, /ユーザートークン/],
  [{ access_token: 123, expires_in: 28800 }, 502, /ユーザートークン/],
  [{ access_token: 'ghu_fixture', expires_in: 0 }, 502, /有効期限が不正/],
  [{ access_token: 'ghu_fixture', expires_in: '28800' }, 502, /有効期限が不正/],
  [null, 502, /応答が不正/]
]) test(`OAuth rejection distinguishes provider errors and token configuration: ${JSON.stringify(response)}`, async t => {
  const f = await fixture();
  const before = f.db.sqlite.prepare('SELECT * FROM sessions').all();
  const begun = await start(f.request('/auth/start'), f.env);
  const state = new URL(begun.headers.get('Location')).searchParams.get('state');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(response));
  const result = await f.worker.fetch(f.request(`/auth/callback?code=test&state=${state}`, 'GET', undefined, {
    Cookie: begun.headers.get('Set-Cookie').split(';')[0]
  }), f.env);
  assert.equal(result.status, status);
  const body = await result.json();
  assert.match(body.error, message);
  assert.ok(body.requestId);
  assert.ok(!JSON.stringify(body).includes('secret-value'));
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM sessions').all(), before);
});

test('static and unknown paths never touch D1 or GitHub; API is no-store JSON', async () => {
  const f = await fixture(); f.env.DOCS_DB = { prepare() { throw new Error('database unavailable'); } };
  const staticResponse = await f.worker.fetch(new Request(f.env.DOCS_ORIGIN + '/missing'), f.env); assert.equal(staticResponse.status, 404);
  const unknown = await f.worker.fetch(f.request('/unknown'), f.env); assert.equal(unknown.status, 404); assert.equal(unknown.headers.get('Cache-Control'), 'no-store');
  const unavailable = await f.worker.fetch(f.request('/session'), f.env); assert.equal(unavailable.status, 503); assert.ok(!(await unavailable.text()).includes('database unavailable'));
  f.env.DOCS_EDITING_ENABLED = 'false'; const setting = await f.worker.fetch(f.request('/session'), f.env); assert.equal((await setting.json()).configured, false);
});
test('bounded body rejects oversized and malformed JSON', async () => {
  await assert.rejects(boundedJson(new Request('https://test/', {method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(101)}),100), { status: 413 });
  await assert.rejects(boundedJson(new Request('https://test/', {method:'POST',headers:{'Content-Type':'application/json'},body:'{'})), { status: 422 });
});

test('rejected input permits correction without leaving a draft slot or writing GitHub', async () => {
  const f = await fixture(), body = await input(f);
  body.files[0].content = '<script>bad</script>';
  await assert.rejects(save(f.env, f.session, body), error => error.status === 422 && error.details.discardOperation);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM changes').first()).n, 0);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM operations').first()).n, 0);
  assert.equal(f.gh.calls.filter(call => call.method !== 'GET').length, 0);
  const result = await save(f.env, f.session, await input(f));
  assert.equal(result.state, 'saved');
});
test('missing strict rules, source injection, incomplete tree and operation key reuse stop safely', async () => {
  const f = await fixture(), body = await input(f), result = await save(f.env, f.session, body);
  f.gh.noStrictRule = true; await assert.rejects(publish(f.env, f.session, result.id, result.head), {status:409});
  await assert.rejects(save(f.env, f.session, {...body, files:[{...body.files[0],content:'# other'}]}), {status:409});
  const latest = await page(f.gh.api,'guide/index', f.gh.prs[0].branch);
  await assert.rejects(save(f.env,f.session,{key:crypto.randomUUID(),head:latest.head,files:[{documentId:'guide/index',sha:latest.sha,content:'<script>bad</script>'}]},result.id),{status:422});
  f.gh.truncated = true; await assert.rejects(page(f.gh.api,'guide/index'),{status:422});
});
test('logout invalidates session, CSRF is not required to read, and OAuth failure is not success', async t => {
  const f = await fixture();
  const logout = await f.worker.fetch(f.request('/logout','POST',{}),f.env); assert.equal(logout.status,200);
  await assert.rejects(session(f.request('/session'),f.env),{status:401});
  const begun = await start(f.request('/auth/start'),f.env), url = new URL(begun.headers.get('Location'));
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:'bad_verification_code'}));
  await assert.rejects(callback(f.request(`/auth/callback?code=bad&state=${url.searchParams.get('state')}`,'GET',undefined,{Cookie:begun.headers.get('Set-Cookie').split(';')[0]}),f.env),{status:401});
});
test('publish and save are serialized; completed merge remains unpublished on failed deployment', async () => {
  const f = await fixture(), result = await save(f.env,f.session,await input(f));
  await f.db.prepare('UPDATE changes SET lock_until=? WHERE id=?').bind(Date.now()+60000,result.id).run();
  await assert.rejects(publish(f.env,f.session,result.id,result.head),{status:409});
  await f.db.prepare('UPDATE changes SET lock_until=0 WHERE id=?').bind(result.id).run();
  await publish(f.env,f.session,result.id,result.head); f.gh.ci='failure';
  assert.equal((await status(f.env,f.session,result.id)).state,'deploy_failed');
});
test('new article must include navigation; existing routes and too many files are rejected', async () => {
  const f=await fixture(), doc=await page(f.gh.api,'guide/index');
  const create = files => save(f.env,f.session,{key:crypto.randomUUID(),head:doc.head,files});
  await assert.rejects(create([{documentId:'guide/new-page',create:true,content:'# New'}]),{status:422});
  await assert.rejects(create([{documentId:'guide/index',create:true,content:'# New'}]),{status:409});
  await assert.rejects(create(Array(4).fill({documentId:'guide/index',sha:doc.sha,content:'# New'})),{status:422});
});
for (const code of [401,403,429,500]) test(`GitHub ${code} is safe and stops authorization`, async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('private-upstream-secret', { status: code }));
  await assert.rejects(authorize(github('ghu_fixture'), 42), e => e.status === (code === 500 ? 502 : code) && !e.message.includes('private-upstream-secret'));
});
