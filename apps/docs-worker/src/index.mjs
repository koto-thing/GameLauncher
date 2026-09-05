import { ApiError, ensure, boundedJson, json, rateLimit } from './http.mjs';
import { configured, start, callback, session, setCookie } from './auth.mjs';
import { authorize } from './github.mjs';
import { page, save, publish, status, owned } from './changes.mjs';
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname, requestId = crypto.randomUUID();
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    let response;
    try {
      const route = /^\/api\/docs\/changes\/([0-9a-f-]+)(\/publish)?$/.exec(path);
      const known = ['/api/docs/auth/start','/api/docs/auth/callback','/api/docs/session','/api/docs/logout','/api/docs/page','/api/docs/changes'].includes(path) || route;
      ensure(known, 404, 'APIが見つかりません。');
      if (!configured(env)) {
        if (path === '/api/docs/session' && request.method === 'GET') response = json({ configured: false, authenticated: false, message: '管理者による設定待ちです。公開資料はログインなしで閲覧できます。' });
        else throw new ApiError(503, '管理者による設定待ちです。');
      } else if (path === '/api/docs/auth/start' && request.method === 'GET') response = await start(request, env);
      else if (path === '/api/docs/auth/callback' && request.method === 'GET') response = await callback(request, env);
      else {
        const mutation = ['POST','PATCH','DELETE'].includes(request.method);
        const current = await session(request, env, mutation);
        if (path === '/api/docs/logout' && request.method === 'POST') {
          await env.DOCS_DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(current.id_hash).run();
          response = json({ ok: true }); response.headers.set('Set-Cookie', setCookie(env, 'session', '', 0));
        } else {
          const user = await authorize(current.api, current.user_id);
          await rateLimit(env.DOCS_DB, `read:${user.id}`, 60);
          if (path === '/api/docs/session' && request.method === 'GET') response = json({ configured: true, authenticated: true, user, csrf: current.csrf, expiresAt: current.expires_at });
          else if (path === '/api/docs/page' && request.method === 'GET') response = json(await page(current.api, url.searchParams.get('documentId')));
          else if (path === '/api/docs/changes' && request.method === 'POST') response = json(await save(env, current, await boundedJson(request)));
          else if (route && !route[2] && request.method === 'PATCH') response = json(await save(env, current, await boundedJson(request), route[1]));
          else if (route && !route[2] && request.method === 'GET') response = json(url.searchParams.has('documentId') ? await page(current.api, url.searchParams.get('documentId'), (await owned(env.DOCS_DB, route[1], current.user_id)).branch) : await status(env, current, route[1]));
          else if (route?.[2] && request.method === 'POST') response = json(await publish(env, current, route[1], (await boundedJson(request, 2000)).head));
          else throw new ApiError(405, 'この操作方法は許可されていません。');
        }
      }
    } catch (error) {
      const statusCode = error instanceof ApiError ? error.status : 503;
      response = json({ error: error instanceof ApiError ? error.message : '編集サービスを利用できません。時間をおいて再試行してください。', requestId, ...(error instanceof ApiError && error.details ? { details: error.details } : {}) }, statusCode);
      console.log(JSON.stringify({ requestId, method: request.method, status: statusCode }));
    }
    response.headers.set('Cache-Control', 'no-store'); response.headers.set('X-Content-Type-Options', 'nosniff'); response.headers.set('Referrer-Policy', 'no-referrer'); response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); response.headers.set('X-Request-ID', requestId);
    return response;
  },
  async scheduled(_event, env) {
    if (!env.DOCS_DB) return;
    const now = Date.now();
    await env.DOCS_DB.batch([
      env.DOCS_DB.prepare('DELETE FROM oauth_attempts WHERE state_hash IN (SELECT state_hash FROM oauth_attempts WHERE expires_at<? LIMIT 200)').bind(now),
      env.DOCS_DB.prepare('DELETE FROM sessions WHERE id_hash IN (SELECT id_hash FROM sessions WHERE expires_at<? LIMIT 200)').bind(now),
      env.DOCS_DB.prepare('DELETE FROM audit WHERE id IN (SELECT id FROM audit WHERE created_at<? LIMIT 200)').bind(now - 90 * 86400000),
      env.DOCS_DB.prepare('DELETE FROM operations WHERE rowid IN (SELECT rowid FROM operations WHERE created_at<? LIMIT 200)').bind(now - 30 * 86400000),
      env.DOCS_DB.prepare('DELETE FROM changes WHERE id IN (SELECT id FROM changes WHERE updated_at<? AND lock_until<? LIMIT 200)').bind(now - 30 * 86400000, now),
      env.DOCS_DB.prepare('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE window<? LIMIT 200)').bind(Math.floor(now / 60000) - 60)
    ]);
  }
};
