import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { fixture } from './fixtures.mjs';
import { page, save, owned } from '../src/changes.mjs';
import { rateLimit } from '../src/http.mjs';
test('real workerd D1 supports migrations, atomic locks, UPSERT RETURNING and save recovery', async () => {
  const mf = new Miniflare({ workers: [{ config: { name: 'docs-test', type: 'worker', compatibilityDate: '2026-09-02', manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: 'export default { fetch() { return new Response("test"); } }' } } }, env: { DOCS_DB: { type: 'd1', id: 'docs-test-db' } } } }] });
  try {
    const db = await mf.getD1Database('DOCS_DB');
    const sql = await readFile(new URL('../migrations/0001_docs.sql',import.meta.url),'utf8');
    for (const statement of sql.split(';').filter(value => value.trim())) await db.prepare(statement).run();
    await rateLimit(db,'test',1); await assert.rejects(rateLimit(db,'test',1),{status:429});
    const f = await fixture(); f.env.DOCS_DB = db;
    const doc=await page(f.gh.api,'guide/index'); const input={key:crypto.randomUUID(),head:doc.head,files:[{documentId:'guide/index',sha:doc.sha,content:'# D1検証\n'}]};
    f.gh.cutPr=true; await assert.rejects(save(f.env,f.session,input)); const saved=await save(f.env,f.session,input);
    const row=await owned(db,saved.id,42); assert.equal(row.head_sha,saved.head); assert.equal(row.lock_until,0); assert.equal(f.gh.prs.length,1);
  } finally { await mf.dispose(); }
});
