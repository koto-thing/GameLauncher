import { createTestHarness } from 'wrangler';
import { fileURLToPath } from 'node:url';

// 任意実行の有限診断。本文や例外messageを出力せずstatusと例外型だけを記録する
for (const mode of ['proxy-unread', 'direct-unread', 'proxy-consumed']) {
  const server = createTestHarness({workers:[{config:{
    name:'multipart-unread-probe',
    main:fileURLToPath(new URL('../tests/fixtures/unread-body-worker.js', import.meta.url)),
    compatibility_date:'2026-10-08', no_bundle:true,
  }}]});
  let unexpected = 0;
  let completed = 0;
  let errorType = null;
  try {
    await server.listen();
    const target = mode === 'direct-unread' ? server.getWorker() : server;
    for (let index = 0; index < 8; index++) {
      const first = await target.fetch('http://localhost/' + (mode === 'proxy-consumed' ? 'reject-read' : 'reject'), {method:'POST',body:'x'.repeat(131072)});
      await first.arrayBuffer();
      if (first.status !== 401) unexpected++;
      const second = await target.fetch('http://localhost/next', {method:'POST',body:'{}'});
      await second.arrayBuffer();
      if (second.status !== 200) unexpected++;
      completed++;
    }
  } catch (error) {
    errorType = error instanceof TypeError ? 'TypeError' : 'other';
  } finally {
    await server.close();
  }
  console.info(JSON.stringify({mode,completed,unexpected,errorType}));
}
