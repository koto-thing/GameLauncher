import { documents, documentPath, newDocumentPath, validateFile, validateNavigation, navigationLinks, MAX_FILES } from '../../docs/editor-policy.mjs';
import { ApiError, ensure, rateLimit } from './http.mjs';
import { hash, random } from './crypto.mjs';
import { REPO, REPOSITORY_ID, WORKFLOW, head, tree, regularFile, readBlob, authorize } from './github.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const shaPattern = /^[0-9a-f]{40}$/;
export async function owned(db, id, userId) {
  ensure(uuid.test(id), 404, '変更が見つかりません。');
  const row = await db.prepare('SELECT * FROM changes WHERE id=? AND user_id=?').bind(id, userId).first(); ensure(row, 404, '変更が見つかりません。'); return row;
}
export async function navigationAt(api, snapshot) {
  const entry = regularFile(snapshot.entries, 'docs/navigation.json');
  const content = await readBlob(api, entry); const value = validateNavigation(JSON.parse(content));
  return { entry, content, value };
}
export async function page(api, id, branch = 'master') {
  const branchHead = await head(api, branch), snapshot = await tree(api, branchHead), navigation = await navigationAt(api, snapshot);
  let path; try { path = id === '$navigation' ? 'docs/navigation.json' : documentPath(id, navigation.value); } catch { throw new ApiError(404, '編集対象が見つかりません。'); }
  const entry = regularFile(snapshot.entries, path);
  const content = await readBlob(api, entry);
  let reason = null; try { validateFile(path, content); } catch (error) { reason = error.message; }
  return { documentId: id, path, content, sha: entry.sha, head: branchHead, editable: !reason, reason, navigation: { content: navigation.content, sha: navigation.entry.sha } };
}
async function validateInput(api, snapshot, files) {
  ensure(Array.isArray(files) && files.length > 0 && files.length <= MAX_FILES, 422, '1変更は1〜3ファイルです。');
  const nav = await navigationAt(api, snapshot);
  const paths = new Set(); const resolved = [];
  for (const file of files) {
    ensure(file && Object.keys(file).every(key => ['documentId','content','sha','create'].includes(key)) && typeof file.content === 'string', 422, '入力項目が不正です。');
    let path; try { path = file.documentId === '$navigation' ? 'docs/navigation.json' : file.create ? newDocumentPath(file.documentId) : documentPath(file.documentId, nav.value); } catch { throw new ApiError(422, '編集対象または新規ページのslugが不正です。'); }
    ensure(!paths.has(path), 422, '同じファイルを重複指定できません。'); paths.add(path);
    const entry = regularFile(snapshot.entries, path, Boolean(file.create));
    if (file.create) {
      const reserved = [path, path.replace(/\.md$/, '/index.md'), `docs/public/${file.documentId}.html`, `docs/public/${file.documentId}/index.html`].map(p => p.toLowerCase());
      ensure(!entry && !Object.hasOwn(documents, file.documentId) && ![...snapshot.entries.keys()].some(p => reserved.includes(p.toLowerCase())), 409, 'そのURLには既にページがあります。');
    }
    else ensure(shaPattern.test(file.sha) && entry.sha === file.sha, 409, '原稿が更新されています。手元の編集を残し、最新版と比較してください。', { path, current: await readBlob(api, entry), sha: entry.sha });
    try { validateFile(path, file.content); } catch (error) { throw new ApiError(422, error.message); }
    resolved.push({ ...file, path });
  }
  const nextNav = resolved.find(file => file.path === 'docs/navigation.json');
  const value = nextNav ? JSON.parse(nextNav.content) : nav.value;
  for (const file of resolved.filter(file => file.create)) ensure(nextNav && navigationLinks(value).includes(`/${file.documentId}`), 422, '新規ページと目次への登録を一緒に保存してください。');
  for (const link of navigationLinks(value)) {
    const route = link.split('#')[0];
    if (Object.values(documents).some(doc => doc.route === route)) continue;
    const path = `docs${route}.md`; ensure(snapshot.entries.has(path) || paths.has(path), 422, '目次のリンク先が存在しません。'); regularFile(snapshot.entries, path, paths.has(path));
  }
  return resolved;
}
async function lock(db, change) {
  const id = random();
  const result = await db.prepare('UPDATE changes SET lock_id=?, lock_until=? WHERE id=? AND lock_until<? RETURNING id').bind(id, Date.now() + 180000, change.id, Date.now()).first();
  ensure(result, 409, '別の保存・公開処理が進行中です。しばらくして同じ操作を再試行してください。'); return id;
}
async function unlock(db, change, id) { await db.prepare('UPDATE changes SET lock_until=0, lock_id=NULL WHERE id=? AND lock_id=?').bind(change.id, id).run(); }
async function audit(db, userId, change, operation, sha) { await db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), userId, change.id, operation, sha, Date.now()).run(); }
export async function save(env, session, input, id) {
  const db = env.DOCS_DB, api = session.api;
  ensure(input && uuid.test(input.key) && shaPattern.test(input.head) && Object.keys(input).every(key => ['key','head','files'].includes(key)), 422, '保存要求が不正です。');
  await authorize(api, session.user_id); await rateLimit(db, `write:${session.user_id}`, 10);
  const digest = await hash(JSON.stringify({ id: id || input.key, head: input.head, files: input.files }));
  let operation = await db.prepare('SELECT * FROM operations WHERE user_id=? AND id=?').bind(session.user_id, input.key).first();
  ensure(!operation || operation.digest === digest, 409, '再試行キーが別の内容に使われています。');
  if (!id) id = input.key;
  let change = await db.prepare('SELECT * FROM changes WHERE id=? AND user_id=?').bind(id, session.user_id).first();
  if (!change) {
    ensure(id === input.key && !operation, 404, '変更が見つかりません。');
    const count = await db.prepare('SELECT count(*) AS n FROM changes WHERE user_id=? AND merge_sha IS NULL').bind(session.user_id).first(); ensure(count.n < 10, 429, '未完了変更は10件までです。');
    ensure(await head(api) === input.head, 409, 'masterが更新されています。最新版と比較して新しい変更を開始してください。', { discardOperation: true });
    const branch = `docs-edit/${session.user_id}/${id}`;
    await db.prepare('INSERT OR IGNORE INTO changes(id,user_id,branch,base_sha,head_sha,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM changes WHERE user_id=? AND merge_sha IS NULL)<10').bind(id, session.user_id, branch, input.head, input.head, Date.now(), Date.now(), session.user_id).run();
    change = await owned(db, id, session.user_id);
  }
  const lockId = await lock(db, change);
  try {
    change = await owned(db, id, session.user_id);
    operation = await db.prepare('SELECT * FROM operations WHERE user_id=? AND id=?').bind(session.user_id, input.key).first();
    ensure(!operation || operation.digest === digest, 409, '再試行キーが一致しません。');
    if (operation?.completed) return savedResult(change);
    ensure(!change.merge_sha && (change.head_sha === input.head || operation?.commit_sha === change.head_sha), 409, '保存元のheadが古いか、既に公開操作済みです。');
    if (change.pr) { const pr = await api(`${REPO}/pulls/${change.pr}`); ensure(pr.state === 'open' && !pr.merged, 409, 'PRが閉じられています。新しい変更を開始してください。'); }
    const snapshot = await tree(api, input.head), files = await validateInput(api, snapshot, input.files);
    if (!operation) {
      await db.prepare('INSERT INTO operations(id,user_id,change_id,digest,expected_head,created_at) VALUES(?,?,?,?,?,?)').bind(input.key, session.user_id, id, digest, input.head, Date.now()).run();
      operation = { expected_head: input.head, commit_sha: null };
    }
    // Persist the commit before changing refs; retries can reconcile an ambiguous ref response.
    if (!operation.commit_sha) {
      const nextTree = await api(`${REPO}/git/trees`, 'POST', { base_tree: snapshot.sha, tree: files.map(file => ({ path: file.path, mode: '100644', type: 'blob', content: file.content })) });
      const commit = await api(`${REPO}/git/commits`, 'POST', { message: `docs: web edit ${id}\n\nOperation: ${input.key}`, tree: nextTree.sha, parents: [input.head] });
      operation.commit_sha = commit.sha;
      await db.prepare('UPDATE operations SET commit_sha=? WHERE user_id=? AND id=?').bind(commit.sha, session.user_id, input.key).run();
    }
    let branchHead;
    try { branchHead = await head(api, change.branch); } catch (error) { if (error.status !== 404) throw error; }
    if (!branchHead) await api(`${REPO}/git/refs`, 'POST', { ref: `refs/heads/${change.branch}`, sha: operation.commit_sha });
    else if (branchHead !== operation.commit_sha) { ensure(branchHead === input.head, 409, '編集ブランチが更新されています。'); await api(`${REPO}/git/refs/heads/${change.branch}`, 'PATCH', { sha: operation.commit_sha, force: false }); }
    ensure(await head(api, change.branch) === operation.commit_sha, 409, '保存後のheadが一致しません。');
    const savedTree = await tree(api, operation.commit_sha);
    for (const file of files) ensure(await readBlob(api, regularFile(savedTree.entries, file.path)) === file.content, 502, '保存内容の再取得が一致しません。');
    let pr = change.pr;
    if (!pr) {
      const prs = await api(`${REPO}/pulls?state=all&head=koto-thing:${change.branch}&base=master&per_page=100`);
      ensure(prs.length <= 1, 409, 'PR状態を一意に確認できません。');
      if (prs.length) { ensure(prs[0].state === 'open', 409, 'PRが閉じられています。'); pr = prs[0].number; }
      else pr = (await api(`${REPO}/pulls`, 'POST', { title: `Docs: ${files.map(file => file.documentId).join(', ')}`, head: change.branch, base: 'master', body: 'Docsサイトから保存された変更です。公開リポジトリのため、この原稿は公開されています。' })).number;
    }
    await db.batch([
      db.prepare('UPDATE changes SET head_sha=?,pr=?,updated_at=? WHERE id=?').bind(operation.commit_sha, pr, Date.now(), id),
      db.prepare('UPDATE operations SET completed=1 WHERE user_id=? AND id=?').bind(session.user_id, input.key)
    ]);
    await audit(db, session.user_id, change, 'save', operation.commit_sha);
    return savedResult(await owned(db, id, session.user_id));
  } catch (error) {
    // A rejected request with no operation record has made no GitHub writes.
    // Let the editor correct its input instead of locking it into a bad retry.
    const operation = await db.prepare('SELECT id FROM operations WHERE user_id=? AND id=?').bind(session.user_id, input.key).first();
    if (!operation && error instanceof ApiError && [409,413,422].includes(error.status)) {
      error.details = { ...error.details, discardOperation: true };
      if (!change.pr && change.head_sha === change.base_sha) await db.prepare('DELETE FROM changes WHERE id=? AND lock_id=?').bind(change.id, lockId).run();
    }
    throw error;
  } finally { await unlock(db, change, lockId); }
}
function savedResult(change) { return { id: change.id, head: change.head_sha, pr: change.pr, prUrl: `https://github.com/koto-thing/GameLauncher/pull/${change.pr}`, state: 'saved' }; }
export async function readiness(api, change) {
  if (!change.pr) return { state: 'saved', message: '保存処理を同じ内容で再試行してください。' };
  const pr = await api(`${REPO}/pulls/${change.pr}`);
  ensure(pr.base.repo.id === REPOSITORY_ID && pr.head.repo.id === REPOSITORY_ID && pr.base.ref === 'master' && pr.head.ref === change.branch && pr.head.sha === change.head_sha, 409, 'PRの対象またはheadが変更されています。');
  if (pr.merged) return { state: 'publishing', mergeSha: pr.merge_commit_sha };
  if (pr.state !== 'open') return { state: 'conflict', message: 'PRが閉じられています。' };
  const base = await head(api);
  if (base !== change.base_sha || pr.base.sha !== base) return { state: 'conflict', message: 'masterが更新されました。最新版と比較し、新しい変更として保存・検証してください。' };
  if (pr.mergeable === false) return { state: 'conflict', message: 'PRに競合があります。' };
  // expected head alone cannot close a base-update race at the merge endpoint.
  // GitHub must atomically enforce an up-to-date required check at merge time.
  const rules = await api(`${REPO}/rules/branches/master?per_page=100`);
  if (!rules.some(rule => rule.type === 'required_status_checks' && rule.parameters.strict_required_status_checks_policy && rule.parameters.required_status_checks.some(check => check.context === 'Docs validation'))) return { state: 'awaiting_approval', message: '管理者設定待ち：masterに「Docs validation」の必須チェックと最新base必須を設定してください。' };
  const workflow = await api(`${REPO}/actions/workflows/${WORKFLOW}`);
  const runs = await api(`${REPO}/actions/workflows/${workflow.id}/runs?event=pull_request&head_sha=${change.head_sha}&per_page=100`);
  const run = runs.workflow_runs.filter(run => run.workflow_id === workflow.id && run.path === `.github/workflows/${WORKFLOW}` && run.head_sha === change.head_sha && run.repository.id === REPOSITORY_ID && run.pull_requests.some(item => item.number === change.pr && item.head.sha === change.head_sha && item.base.sha === base)).sort((a,b) => b.id-a.id)[0];
  if (!run || run.status !== 'completed') return { state: 'checking', message: '最新head・baseのドキュメント検証を待っています。' };
  if (run.conclusion !== 'success') return { state: 'validation_failed', message: 'ドキュメント検証が失敗しました。PR詳細でログを確認してください。' };
  if (!pr.mergeable || !['clean','unstable','has_hooks'].includes(pr.mergeable_state)) return { state: 'awaiting_approval', message: 'GitHubの承認・スレッド解決・保護規則の充足待ちです。' };
  return { state: 'ready', message: '検証済みです。公開操作ができます。', base, head: change.head_sha };
}
async function inspectPull(api, change) {
  const pr = await api(`${REPO}/pulls/${change.pr}`);
  ensure(pr.changed_files > 0 && pr.changed_files <= MAX_FILES, 422, '変更ファイル数が許可範囲を超えています。');
  const files = await api(`${REPO}/pulls/${change.pr}/files?per_page=100`);
  ensure(files.length === pr.changed_files, 422, 'PR差分全体を取得できません。');
  const snapshot = await tree(api, change.head_sha);
  for (const file of files) { ensure(['added','modified'].includes(file.status) && !file.previous_filename, 422, '削除・移動は公開できません。'); const entry = regularFile(snapshot.entries, file.filename); try { validateFile(file.filename, await readBlob(api, entry)); } catch (error) { throw new ApiError(422, error.message); } }
}
export async function publish(env, session, id, expectedHead) {
  const db = env.DOCS_DB, api = session.api;
  await authorize(api, session.user_id); await rateLimit(db, `write:${session.user_id}`, 10);
  let change = await owned(db, id, session.user_id); const lockId = await lock(db, change);
  try {
    change = await owned(db, id, session.user_id);
    ensure(expectedHead === change.head_sha, 409, '画面で確認したheadが古くなっています。');
    let status = await readiness(api, change);
    if (status.state !== 'publishing') {
      ensure(status.state === 'ready', 409, status.message);
      await inspectPull(api, change);
      // Recheck base/head and authorization immediately before the irreversible API call.
      await authorize(api, session.user_id); status = await readiness(api, change); ensure(status.state === 'ready', 409, status.message);
      const merged = await api(`${REPO}/pulls/${change.pr}/merge`, 'PUT', { merge_method: 'squash', sha: change.head_sha });
      ensure(merged.merged && shaPattern.test(merged.sha), 409, 'GitHubがマージを受理しませんでした。'); status = { state: 'publishing', mergeSha: merged.sha };
    }
    await db.prepare('UPDATE changes SET merge_sha=?,updated_at=? WHERE id=?').bind(status.mergeSha, Date.now(), id).run();
    await audit(db, session.user_id, change, 'merge', status.mergeSha); return status;
  } finally { await unlock(db, change, lockId); }
}
export async function status(env, session, id) {
  const change = await owned(env.DOCS_DB, id, session.user_id);
  const result = await readiness(session.api, change);
  if (result.state !== 'publishing') return { ...savedResult(change), ...result };
  const response = await env.ASSETS.fetch(new Request(`${env.DOCS_ORIGIN}/version.json`));
  if (response.ok) {
    const version = await response.json();
    if (shaPattern.test(version.commit)) {
      const comparison = await session.api(`${REPO}/compare/${result.mergeSha}...${version.commit}`);
      if (['ahead','identical'].includes(comparison.status)) return { ...savedResult(change), state: 'published', message: 'この変更を含む版が公開されています。', version: version.commit };
    }
  }
  const runs = await session.api(`${REPO}/actions/workflows/${WORKFLOW}/runs?event=push&head_sha=${result.mergeSha}&per_page=100`);
  const run = runs.workflow_runs.filter(run => run.head_sha === result.mergeSha).sort((a,b) => b.id-a.id)[0];
  return { ...savedResult(change), ...result, state: run?.status === 'completed' && run.conclusion !== 'success' ? 'deploy_failed' : 'publishing', message: 'masterへ反映済みです。ビルド・配信結果と公開版を確認しています。' };
}
