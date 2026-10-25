// ローカル統合試験専用。実運営 proxy の認証の代わりに配備してはいけない
export default { async fetch(request, env) {
  if(new URL(request.url).pathname==='/test/retention' && request.method==='POST'){try{return new Response(await env.LT_INTERNAL.testRetention(await request.text()),{headers:{'Content-Type':'application/json'}});}catch{return Response.json({error:'refused'},{status:409});}}

  const rolePath=new URL(request.url).pathname.split('/');
  if(rolePath[1]==='test' && rolePath[2]==='role' && ['admin','executive','assistant'].includes(rolePath[3])) {
    const url=new URL(request.url);url.pathname='/'+rolePath.slice(4).join('/');
    return env.LT_INTERNAL.operate({actorId:'email-fixture',role:rolePath[3],requestId:crypto.randomUUID()},new Request(url,request));
  }
  if(new URL(request.url).pathname==='/test/change-mail' && request.method==='POST') return Response.json({confirmationUrl:await env.LT_INTERNAL.testChangeMail(await request.text())},{headers:{'Cache-Control':'no-store'}});
  if(new URL(request.url).pathname==='/test/clock' && request.method==='POST') {await env.LT_INTERNAL.testClock(await request.text());return Response.json({ok:true});}
  if(new URL(request.url).pathname==='/test/fake-mail' && request.method==='POST') return Response.json({confirmationUrl:await env.LT_INTERNAL.testMail(await request.text())},{headers:{'Cache-Control':'no-store'}});
  if(new URL(request.url).pathname==='/test/dispatch-outcome' && request.method==='POST') return Response.json({delivered:await env.LT_INTERNAL.testDispatch(await request.text())});
  if(new URL(request.url).pathname==='/test/dispatch-fake') return Response.json({delivered:await env.LT_INTERNAL.dispatchFake()});
  return env.LT_INTERNAL.operate({ actorId:'fixture-operator', role:'assistant', requestId:crypto.randomUUID() }, request);
}};
