import { validateMarkdown, MAX_DOCUMENT_BYTES } from '../../docs/editor-policy.mjs';
import { fixture } from '../tests/fixtures.mjs';
import { page, save } from '../src/changes.mjs';
const samples = {
  prose: '日本語の説明です。\n\n'.repeat(3000),
  table: '| 値 | 説明 |\n'.repeat(3000),
  brackets: '['.repeat(MAX_DOCUMENT_BYTES),
  maximum: 'a'.repeat(MAX_DOCUMENT_BYTES),
};
for (const [name, raw] of Object.entries(samples)) {
  const content = new TextDecoder().decode(new TextEncoder().encode(raw).slice(0, MAX_DOCUMENT_BYTES - 3));
  const times = []; const batchCpu = process.cpuUsage(); const wallStart = performance.now();
  for (let i = 0; i < 100; i++) { const start = process.cpuUsage(); try { validateMarkdown(content); } catch { /* Rejected complexity is measured too. */ } const elapsed = process.cpuUsage(start); times.push((elapsed.user + elapsed.system) / 1000); }
  const batch = process.cpuUsage(batchCpu); console.log(JSON.stringify({ test:name,bytes:Buffer.byteLength(content),nodeCpuMeanMs:(batch.user+batch.system)/100000,nodeWallMeanMs:(performance.now()-wallStart)/100 }));
}
const f = await fixture(), doc = await page(f.gh.api, 'guide/index');
const started = process.cpuUsage(); await save(f.env,f.session,{key:crypto.randomUUID(),head:doc.head,files:[{documentId:'guide/index',content:'x'.repeat(MAX_DOCUMENT_BYTES),sha:doc.sha}]});
const elapsed = process.cpuUsage(started); console.log(JSON.stringify({test:'save-16KiB-mock',nodeCpuMs:(elapsed.user+elapsed.system)/1000,githubRequests:f.gh.calls.length}));
console.log('Node/SQLite mock measurements are not Cloudflare CPU measurements. Measure all API maxima on the target Free account before enabling editing.');
