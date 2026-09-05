import { ApiError, ensure } from './http.mjs';
import { MAX_DOCUMENT_BYTES } from '../../docs/editor-policy.mjs';
export const REPOSITORY = 'koto-thing/GameLauncher';
export const REPOSITORY_ID = 1152962221;
export const REPO = `/repos/${REPOSITORY}`;
export const WORKFLOW = 'docs-cloudflare.yml';
export const GITHUB_TIMEOUT_MS = 60000;
export function github(token) {
  return async (path, method = 'GET', body) => {
    ensure(path.startsWith('/') && !path.startsWith('//'), 422, 'APIパスが不正です。');
    let response;
    // workerd supports manual; the status check below rejects redirects without forwarding the token.
    try {
      response = await fetch(`https://api.github.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'PandD-Docs', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS), redirect: 'manual' });
    } catch { throw new ApiError(502, 'GitHubに接続できません。時間をおいて再試行してください。'); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new ApiError(401, 'GitHub認証が失効しました。再ログインしてください。');
      if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')) throw new ApiError(429, 'GitHubの利用上限です。時間をおいて再試行してください。');
      throw new ApiError([403,404,409,422].includes(response.status) ? response.status : 502, ({403:'GitHubの権限または保護規則により操作できません。',404:'対象が見つからないかAppの対象外です。',409:'変更が競合しています。',422:'GitHubが変更を受理しませんでした。内容と保護規則を確認してください。'})[response.status] || 'GitHubで障害が発生しています。');
    }
    if (response.status === 204) return null;
    // GitHub endpoints used below have bounded page sizes; cap tree/blob responses too.
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 4000000) { await reader.cancel(); throw new ApiError(502, 'GitHubの応答が検査上限を超えました。'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  };
}
export async function authorize(api, userId) {
  const user = await api('/user');
  ensure(Number.isSafeInteger(user.id) && (!userId || user.id === userId), 403, 'ログインしたユーザーが一致しません。');
  const repo = await api(REPO);
  ensure(repo.id === REPOSITORY_ID && repo.full_name === REPOSITORY && repo.permissions?.push === true, 403, '対象リポジトリへの書き込み権限がありません。');
  const permission = await api(`${REPO}/collaborators/${encodeURIComponent(user.login)}/permission`);
  ensure(['write','maintain','admin'].includes(permission.permission) && permission.user?.id === user.id, 403, 'Collaboratorのwrite権限が必要です。');
  return { id: user.id, login: user.login };
}
export async function head(api, branch = 'master') { return (await api(`${REPO}/git/ref/heads/${branch}`)).object.sha; }
export async function tree(api, sha) {
  const commit = await api(`${REPO}/git/commits/${sha}`);
  const result = await api(`${REPO}/git/trees/${commit.tree.sha}?recursive=1`);
  ensure(!result.truncated, 422, 'Git tree全体を検査できないため停止しました。');
  return { sha: commit.tree.sha, entries: new Map(result.tree.map(entry => [entry.path, entry])) };
}
export function regularFile(entries, path, allowMissing = false) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) { const parent = entries.get(parts.slice(0, i).join('/')); ensure(parent?.type === 'tree' && parent.mode === '040000', 422, '親パスが通常のディレクトリではありません。'); }
  const entry = entries.get(path);
  ensure((allowMissing && !entry) || (entry?.type === 'blob' && entry.mode === '100644'), 422, '通常ファイル以外は編集できません。');
  return entry;
}
export async function readBlob(api, entry) {
  const blob = await api(`${REPO}/git/blobs/${entry.sha}`);
  ensure(blob.encoding === 'base64' && blob.size <= MAX_DOCUMENT_BYTES, 413, '原稿サイズが上限を超えています。');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(blob.content.replace(/\s/g, '')), c => c.charCodeAt(0))); } catch { throw new ApiError(422, 'UTF-8の原稿ではありません。'); }
}
