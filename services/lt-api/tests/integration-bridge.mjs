// ローカル統合専用。contextは実proxyを通ったテストから受け取り、本番配備しない
export default { async fetch(request, env) {
 if (new URL(request.url).hostname !== '127.0.0.1' || request.method !== 'POST') return new Response('',{status:404});
 const { context, path, method, body } = await request.json();
 return env.LT_INTERNAL.operate(context,new Request('https://lt.internal'+path,{method,headers:{'Content-Type':'application/json'},body:method==='GET'?undefined:body}));
}};
