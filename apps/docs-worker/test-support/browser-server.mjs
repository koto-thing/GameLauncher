// Explicit local UI test fixture. Never imported by the production Worker.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fixture } from '../tests/fixtures.mjs';
const f = await fixture();
await f.db.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() + 6 * 60 * 60 * 1000).run();
const root = resolve(import.meta.dirname, '../../docs/dist');
globalThis.fetch = async (url, options = {}) => {
  if (new URL(url).origin !== 'https://api.github.com') throw new Error('External network is disabled in the UI fixture');
  try { return Response.json(await f.gh.api(new URL(url).pathname + new URL(url).search, options.method || 'GET', options.body ? JSON.parse(options.body) : undefined)); }
  catch (error) { return Response.json({ error: 'fixture' }, {status: error.status || 502}); }
};
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:8790');
    if (url.pathname.startsWith('/api/docs/')) {
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 210000) throw new Error('too large'); }
      const result = await f.worker.fetch(f.request(request.url.slice('/api/docs'.length), request.method, body ? JSON.parse(body) : undefined, { 'X-CSRF-Token': request.headers['x-csrf-token'] || '' }), f.env);
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer())); return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + '\\') && !path.startsWith(root + '/') && path !== root) throw new Error('invalid path');
    let file; for (const candidate of [path, path + '.html', resolve(path, 'index.html')]) { try { if ((await stat(candidate)).isFile()) { file = candidate; break; } } catch {} }
    if (!file) { response.writeHead(404); response.end('Not found'); return; }
    let content = await readFile(file);
    if (file.endsWith('.html')) content = Buffer.from(content.toString().replace('<body>', '<body><div style="padding:8px;background:#fff1b8;color:#212121;font:14px system-ui">LOCAL TEST · GitHubはモックです。実際の保存・公開は行いません。</div>'));
    response.writeHead(200, {'Content-Type':mime[extname(file)] || 'application/octet-stream'}); response.end(content);
  } catch (error) { response.writeHead(500); response.end('Local fixture error'); console.error(error.message); }
}).listen(8790, '127.0.0.1', () => console.log('UI fixture: http://127.0.0.1:8790/editor (isolated mock GitHub; no real writes)'));
