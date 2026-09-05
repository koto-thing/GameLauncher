import { ensure, ApiError, rateLimit, boundedJson } from './http.mjs';
import { random, hash, encrypt, decrypt, equal } from './crypto.mjs';
import { github, authorize, REPOSITORY_ID } from './github.mjs';
import { documents } from '../../docs/editor-policy.mjs';
export function cookieName(env, purpose) { return `${env.DOCS_ORIGIN.startsWith('https:') ? '__Host-' : ''}pandd_docs_${purpose}`; }
export function cookie(request, name) { return request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
export function setCookie(env, purpose, value, age) { return `${cookieName(env, purpose)}=${value}; HttpOnly; ${env.DOCS_ORIGIN.startsWith('https:') ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${age}`; }
export function configured(env) {
  try { const origin = new URL(env.DOCS_ORIGIN); return env.DOCS_EDITING_ENABLED === 'true' && origin.origin === env.DOCS_ORIGIN && (origin.protocol === 'https:' || origin.origin === 'http://localhost:8787') && Boolean(env.DOCS_DB && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.DOCS_TOKEN_KEY); } catch { return false; }
}
export function returnTo(value = '/editor') {
  ensure(value === '/editor' || value.startsWith('/editor?documentId='), 422, '戻り先が不正です。');
  if (value === '/editor') return value;
  const raw = value.slice('/editor?documentId='.length);
  let id; try { id = decodeURIComponent(raw); } catch { throw new ApiError(422, '戻り先が不正です。'); }
  ensure(raw === id || raw === encodeURIComponent(id), 422, '戻り先のエンコードが不正です。');
  ensure(id === '$navigation' || Boolean(documents[id]?.path) || /^guide\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id), 422, '戻り先が不正です。');
  return `/editor?documentId=${encodeURIComponent(id)}`;
}
export async function start(request, env) {
  await rateLimit(env.DOCS_DB, `oauth:${await hash(request.headers.get('CF-Connecting-IP') || 'local')}`, 10);
  const target = returnTo(new URL(request.url).searchParams.get('returnTo') || undefined);
  const state = random(), browser = random(), verifier = random();
  const stateHash = await hash(state);
  await env.DOCS_DB.prepare('INSERT INTO oauth_attempts VALUES(?,?,?,?,?)').bind(stateHash, await hash(browser), await encrypt(verifier, env.DOCS_TOKEN_KEY, stateHash), target, Date.now() + 600000).run();
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${env.DOCS_ORIGIN}/api/docs/auth/callback`, state, code_challenge: await hash(verifier), code_challenge_method: 'S256', allow_signup: 'false' }).toString();
  return new Response(null, { status: 302, headers: { Location: url.href, 'Set-Cookie': setCookie(env, 'oauth', browser, 600) } });
}
export async function callback(request, env) {
  const query = new URL(request.url).searchParams;
  const state = query.get('state'), browser = cookie(request, cookieName(env, 'oauth')), code = query.get('code');
  ensure(state && browser && code && state.length === 43 && code.length <= 256, 401, 'ログインを最初からやり直してください。');
  const stateHash = await hash(state);
  const attempt = await env.DOCS_DB.prepare('DELETE FROM oauth_attempts WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *').bind(stateHash, await hash(browser), Date.now()).first();
  ensure(attempt, 401, 'ログイン試行が失効したか、既に使用されています。');
  let response;
  try { response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${env.DOCS_ORIGIN}/api/docs/auth/callback`, code_verifier: await decrypt(attempt.verifier, env.DOCS_TOKEN_KEY, stateHash), repository_id: String(REPOSITORY_ID) }), signal: AbortSignal.timeout(10000), redirect: 'error' }); } catch { throw new ApiError(502, 'GitHub認証に接続できません。'); }
  ensure(response.ok, 502, 'GitHub認証で障害が発生しています。');
  const result = await boundedJson(response, 16384);
  ensure(result.access_token?.startsWith('ghu_') && Number.isInteger(result.expires_in) && result.expires_in > 0, 401, '有効期限付きGitHub App認証が必要です。');
  const user = await authorize(github(result.access_token));
  const session = random(), idHash = await hash(session), csrf = random();
  const seconds = Math.min(28800, result.expires_in);
  const old = cookie(request, cookieName(env, 'session'));
  await env.DOCS_DB.batch([
    env.DOCS_DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(await hash(old)),
    env.DOCS_DB.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').bind(idHash, user.id, await encrypt(result.access_token, env.DOCS_TOKEN_KEY, `${idHash}:${user.id}`), csrf, Date.now() + seconds * 1000)
  ]);
  const headers = new Headers({ Location: `${env.DOCS_ORIGIN}${returnTo(attempt.return_to)}` });
  headers.append('Set-Cookie', setCookie(env, 'session', session, seconds)); headers.append('Set-Cookie', setCookie(env, 'oauth', '', 0));
  return new Response(null, { status: 302, headers });
}
export async function session(request, env, mutation = false) {
  const raw = cookie(request, cookieName(env, 'session'));
  ensure(/^[\w-]{43}$/.test(raw), 401, 'GitHubでログインしてください。');
  const idHash = await hash(raw);
  const row = await env.DOCS_DB.prepare('SELECT * FROM sessions WHERE id_hash=? AND expires_at>?').bind(idHash, Date.now()).first();
  ensure(row, 401, 'セッションが失効しました。再ログインしてください。');
  if (mutation) {
    ensure(request.headers.get('Origin') === env.DOCS_ORIGIN && request.headers.get('content-type')?.split(';')[0] === 'application/json' && await equal(request.headers.get('X-CSRF-Token'), row.csrf), 403, '操作元を確認できません。ページを再読み込みしてください。');
  }
  let token; try { token = await decrypt(row.token, env.DOCS_TOKEN_KEY, `${idHash}:${row.user_id}`); } catch { throw new ApiError(401, 'セッションが失効しました。再ログインしてください。'); }
  return { ...row, api: github(token) };
}
