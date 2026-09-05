import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { fixture } from './fixtures.mjs';
import { start, callback, session } from '../src/auth.mjs';
import { github } from '../src/github.mjs';
import { hash } from '../src/crypto.mjs';

// Execute the production fetch options in workerd: Node accepts redirect modes
// that Workers rejects, so a plain fetch stub cannot detect this regression.
test('OAuth and authenticated requests use workerd-compatible fetch without following redirects', async t => {
  const f = await fixture();
  const calls = [];
  let redirectStatus = 0;
  let challenge;
  const mf = new Miniflare({ workers: [{
    config: {
      name: 'auth-fetch-test', type: 'worker', compatibilityDate: '2026-09-02',
      manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: `
        export default { async fetch(request) {
          const { url, options } = await request.json();
          try {
            const response = await fetch(url, options);
            return Response.json({ status: response.status, headers: [...response.headers], body: await response.text() });
          } catch (error) { return Response.json({ error: error.message }); }
        } }` } } }
    },
    dev: { outboundService: { type: 'fetcher', handler: async request => {
      calls.push(request.url);
      assert.ok(['github.com', 'api.github.com'].includes(new URL(request.url).hostname));
      if (redirectStatus) return new Response('redirect', { status: redirectStatus, headers: { Location: 'https://unexpected.test/credentials' } });
      if (new URL(request.url).pathname === '/login/oauth/access_token') {
        const body = new URLSearchParams(await request.text());
        assert.equal(await hash(body.get('code_verifier')), challenge);
        return Response.json({ access_token: 'ghu_fixture', expires_in: 28800 });
      }
      assert.equal(request.headers.get('Authorization'), 'Bearer ghu_fixture');
      return Response.json(await f.gh.api(new URL(request.url).pathname));
    } } }
  }] });
  try {
    await mf.ready;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const response = await mf.dispatchFetch('http://localhost/fetch', {
        method: 'POST', body: JSON.stringify({ url, options: {
          method: options.method, headers: options.headers, redirect: options.redirect,
          body: options.body?.toString()
        } })
      });
      const result = await response.json();
      if (result.error) throw new TypeError(result.error);
      return new Response(result.body, { status: result.status, headers: result.headers });
    });
    async function login() {
      const begun = await start(f.request('/auth/start'), f.env);
      const url = new URL(begun.headers.get('Location'));
      challenge = url.searchParams.get('code_challenge');
      return callback(f.request(`/auth/callback?code=test&state=${url.searchParams.get('state')}`, 'GET', undefined, {
        Cookie: begun.headers.get('Set-Cookie').split(';')[0]
      }), f.env);
    }
    const loggedIn = await login();
    assert.equal(loggedIn.status, 302);
    assert.equal(loggedIn.headers.get('Location'), f.env.DOCS_ORIGIN + '/editor');
    const current = await session(f.request('/session', 'GET', undefined, {
      Cookie: loggedIn.headers.getSetCookie()[0].split(';')[0]
    }), f.env);
    assert.equal(current.user_id, 42);
    assert.equal((await current.api('/user')).id, 42);

    for (const status of [302, 307]) {
      redirectStatus = status;
      let count = calls.length;
      await assert.rejects(login(), { status: 502, message: 'GitHub認証で障害が発生しています。' });
      assert.equal(calls.length, count + 1, 'OAuth must not forward its secret to a redirect');
      count = calls.length;
      await assert.rejects(github('ghu_fixture')('/user'), { status: 502 });
      assert.equal(calls.length, count + 1, 'API must not forward its token to a redirect');
    }
  } finally { await mf.dispose(); }
});
