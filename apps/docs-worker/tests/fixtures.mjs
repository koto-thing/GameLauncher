import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker from '../src/index.mjs';
import { random, hash, encrypt, base64 } from '../src/crypto.mjs';
import { REPO, REPOSITORY_ID, REPOSITORY, WORKFLOW } from '../src/github.mjs';
export class Database {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec(readFileSync(new URL('../migrations/0001_docs.sql', import.meta.url), 'utf8')); }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    const bind = (...args) => ({ first: async () => statement.get(...args) || null, all: async () => ({ results: statement.all(...args) }), run: async () => ({ success: true, meta: statement.run(...args) }), execute: () => statement.run(...args) });
    return { ...bind(), bind };
  }
  async batch(statements) { this.sqlite.exec('BEGIN'); try { const results = statements.map(statement => statement.execute()); this.sqlite.exec('COMMIT'); return results; } catch (e) { this.sqlite.exec('ROLLBACK'); throw e; } }
}
const sha = data => createHash('sha1').update(JSON.stringify(data)).digest('hex');
export class GitHub {
  constructor() {
    this.user = { id: 42, login: 'collaborator' }; this.permission = 'write'; this.push = true; this.repoId = REPOSITORY_ID;
    this.blobs = new Map(); this.trees = new Map(); this.commits = new Map(); this.refs = new Map(); this.prs = []; this.calls = []; this.ci = 'success'; this.mergeable = true; this.mergeableState = 'clean'; this.published = null;
    const entries = [{ path: 'docs', mode: '040000', type: 'tree' }, { path: 'docs/guide', mode: '040000', type: 'tree' }];
    for (const path of ['docs/guide/index.md','docs/navigation.json','docs/index.md']) entries.push({ path, mode: '100644', type: 'blob', sha: this.addBlob(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')) });
    const treeSha = sha(entries); this.trees.set(treeSha, entries); this.base = sha('base'); this.commits.set(this.base, { sha: this.base, tree: { sha: treeSha }, parents: [] }); this.refs.set('master', this.base);
  }
  addBlob(content) { const id = sha(content); this.blobs.set(id, content); return id; }
  repository() { return { id: this.repoId, full_name: REPOSITORY, permissions: { push: this.push } }; }
  pull(pr) { return { ...pr, base: { repo: this.repository(), ref: 'master', sha: this.refs.get('master') }, head: { repo: this.repository(), ref: pr.branch, sha: this.refs.get(pr.branch) }, mergeable: this.mergeable, mergeable_state: this.mergeableState, changed_files: this.files(pr).length }; }
  files(pr) {
    const original = new Map(this.trees.get(this.commits.get(this.base).tree.sha).map(e => [e.path,e]));
    return this.trees.get(this.commits.get(this.refs.get(pr.branch)).tree.sha).filter(e => e.type === 'blob' && e.sha !== original.get(e.path)?.sha).map(e => ({ filename: e.path, status: original.has(e.path) ? 'modified' : 'added' }));
  }
  api = async (path, method = 'GET', body) => {
    this.calls.push({ path, method, body });
    if (this.failure && path.includes(this.failure.path)) { const e = new Error('upstream failure'); e.status = this.failure.status; throw e; }
    if (path === '/user') return this.user;
    if (path === REPO) return this.repository();
    if (path.includes('/rules/branches/')) return this.noStrictRule ? [] : [{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'Docs validation' }] } }];
    if (path.includes('/collaborators/')) return { permission: this.permission, user: this.user };
    if (path.startsWith(`${REPO}/git/ref/heads/`)) { const id = this.refs.get(path.split('/heads/')[1]); if (!id) { const e = new Error('not found'); e.status = 404; throw e; } return { object: { sha: id } }; }
    if (path === `${REPO}/git/refs`) { const branch = body.ref.slice(11); if (this.refs.has(branch)) { const e = new Error('already exists'); e.status = 422; throw e; } this.refs.set(branch, body.sha); if (this.cutRef) { this.cutRef = false; throw new Error('response lost'); } return {}; }
    if (path.startsWith(`${REPO}/git/refs/heads/`)) { const branch = path.split('/heads/')[1]; if (body.force || this.commits.get(body.sha).parents[0].sha !== this.refs.get(branch)) { const e = new Error('non-fast-forward'); e.status = 422; throw e; } this.refs.set(branch, body.sha); return {}; }
    if (path === `${REPO}/git/trees`) { const entries = new Map(this.trees.get(body.base_tree).map(e => [e.path,e])); for (const entry of body.tree) entries.set(entry.path, { path: entry.path, type: entry.type, mode: entry.mode, sha: this.addBlob(entry.content) }); const list = [...entries.values()], id = sha(list); this.trees.set(id, list); return { sha: id }; }
    if (path.startsWith(`${REPO}/git/trees/`)) return { tree: this.trees.get(path.split('/trees/')[1].split('?')[0]), truncated: this.truncated || false };
    if (path === `${REPO}/git/commits`) { const id = sha(body); const value = { sha: id, tree: { sha: body.tree }, parents: body.parents.map(sha => ({ sha })) }; this.commits.set(id, value); return value; }
    if (path.startsWith(`${REPO}/git/commits/`)) return this.commits.get(path.split('/commits/')[1]);
    if (path.startsWith(`${REPO}/git/blobs/`)) { const content = this.blobs.get(path.split('/blobs/')[1]); return { encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') }; }
    if (path === `${REPO}/pulls`) { const pr = { number: this.prs.length + 1, branch: body.head, state: 'open', merged: false }; this.prs.push(pr); if (this.cutPr) { this.cutPr = false; throw new Error('response lost'); } return this.pull(pr); }
    if (path.startsWith(`${REPO}/pulls?`)) return this.prs.filter(pr => path.includes(pr.branch)).map(pr => this.pull(pr));
    if (path.startsWith(`${REPO}/pulls/`)) {
      const number = Number(path.split('/pulls/')[1].split('/')[0]), pr = this.prs[number - 1];
      if (path.includes('/files?')) return this.extraFiles || this.files(pr);
      if (path.endsWith('/merge')) { if (body.sha !== this.refs.get(pr.branch)) { const e = new Error('head mismatch'); e.status = 409; throw e; } pr.merged = true; pr.state = 'closed'; pr.merge_commit_sha = sha('merge:' + body.sha); this.commits.set(pr.merge_commit_sha, this.commits.get(body.sha)); this.refs.set('master', pr.merge_commit_sha); if (this.cutMerge) { this.cutMerge = false; throw new Error('response lost'); } return { merged: true, sha: pr.merge_commit_sha }; }
      return this.pull(pr);
    }
    if (path === `${REPO}/actions/workflows/${WORKFLOW}`) return { id: 123 };
    if (path.includes('/actions/workflows/') && path.includes('/runs?')) {
      const requested = new URL('https://api.github.com' + path).searchParams.get('head_sha');
      return { workflow_runs: [{ id: 100, workflow_id: 123, path: `.github/workflows/${WORKFLOW}`, repository: this.repository(), head_sha: this.ciHead || requested, status: this.ci === 'pending' ? 'in_progress' : 'completed', conclusion: this.ci, pull_requests: this.prs.map(pr => ({ number: pr.number, head: { sha: this.refs.get(pr.branch) }, base: { sha: this.ciBase || this.base } })) }] };
    }
    if (path.includes('/compare/')) return { status: this.comparison || 'identical' };
    throw new Error(`Unexpected mock request: ${method} ${path}`);
  };
}
export async function fixture() {
  const db = new Database(), gh = new GitHub();
  const env = { DOCS_DB: db, DOCS_ORIGIN: 'https://docs.example.test', DOCS_EDITING_ENABLED: 'true', GITHUB_CLIENT_ID: 'fixture', GITHUB_CLIENT_SECRET: 'fixture-secret', DOCS_TOKEN_KEY: base64(crypto.getRandomValues(new Uint8Array(32))), ASSETS: { fetch: async () => gh.published ? Response.json({ commit: gh.published }) : new Response('static', { status: 404 }) } };
  const raw = random(), id_hash = await hash(raw), csrf = random();
  await db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').bind(id_hash, 42, await encrypt('ghu_fixture', env.DOCS_TOKEN_KEY, `${id_hash}:42`), csrf, Date.now() + 100000).run();
  const session = { user_id: 42, api: gh.api, csrf, id_hash };
  const request = (path, method = 'GET', body, headers = {}) => new Request(`${env.DOCS_ORIGIN}/api/docs${path}`, { method, headers: { Cookie: `__Host-pandd_docs_session=${raw}`, Origin: env.DOCS_ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { db, gh, env, session, request, raw, worker };
}
