import { proxyLtCore } from '../../lib/lt/proxy-core';

// ローカルworkerd専用。通常認証・本番binding・実データは使用しない
export default {
  /** @brief 実Workers Requestでproxyの構築とヘッダー境界を検証する */
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/unsupported') {
      try {
        new Request('https://example.invalid/', { redirect: 'error' });
        return Response.json({ rejected: false });
      } catch (error) {
        return Response.json({ rejected: error instanceof TypeError });
      }
    }
    return proxyLtCore(request, async () => {
      if (request.headers.get('x-local-fixture') !== 'allowed') throw new Response('', { status: 401 });
      return { githubUserId: 'synthetic-local-only', role: 'assistant' };
    }, { async fetch(internal) {
      if (new URL(internal.url).searchParams.has('redirect')) {
        return new Response(null, { status: 302, headers: { Location: 'https://example.invalid/never-follow' } });
      }
      return Response.json({ redirect: internal.redirect, cookie: internal.headers.has('cookie'),
        authorization: internal.headers.has('authorization'), role: internal.headers.has('x-role'),
        method: internal.method, body: internal.method === 'GET' ? null : await internal.json() });
    } });
  },
};
