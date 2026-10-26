// ローカル診断専用。認証情報・外部サービス・永続データを使用しない
export default {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/reject') return new Response('', {status:401});
    await request.arrayBuffer();
    return new Response('ok', {status: pathname === '/reject-read' ? 401 : 200});
  },
};
