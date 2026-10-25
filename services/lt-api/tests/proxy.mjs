// ローカル統合試験専用。実運営 proxy の認証の代わりに配備してはいけない
export default { async fetch(request, env) {
  if(new URL(request.url).pathname==='/test/dispatch-fake') return Response.json({delivered:await env.LT_INTERNAL.dispatchFake()});
  return env.LT_INTERNAL.operate({ actorId:'fixture-operator', role:'assistant', requestId:'local-rpc-test' }, request);
}};
