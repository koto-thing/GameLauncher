// ローカル統合試験専用。実運営 proxy の認証の代わりに配備してはいけない
export default { async fetch(request, env) {
  if(new URL(request.url).pathname==='/test/fake-mail' && request.method==='POST') return Response.json({confirmationUrl:await env.LT_INTERNAL.testMail(await request.text())},{headers:{'Cache-Control':'no-store'}});
  if(new URL(request.url).pathname==='/test/dispatch-fake') return Response.json({delivered:await env.LT_INTERNAL.dispatchFake()});
  return env.LT_INTERNAL.operate({ actorId:'fixture-operator', role:'assistant', requestId:'local-rpc-test' }, request);
}};
