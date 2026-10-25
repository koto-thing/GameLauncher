// 統合専用。fixtureを使わずlocalhostのRust APIだけへ接続する
import { createServer } from "vite-plus";
const origin = "http://127.0.0.1:18880";
const server = await createServer({
  configFile: false,
  server: { host: "127.0.0.1", port: 18880, strictPort: true },
  plugins: [
    {
      name: "isolated-live-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url.startsWith("/api/lt/")) return next();
          if (req.headers.origin && req.headers.origin !== origin) {
            res.writeHead(403);
            res.end();
            return;
          }
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const headers = new Headers(req.headers);
          if (headers.has("origin")) headers.set("origin", "http://127.0.0.1:18877");
          headers.delete("host");
          headers.set("accept-encoding", "identity");
          try {
            const r = await fetch("http://127.0.0.1:18877" + req.url, {
              method: req.method,
              headers,
              body: req.method === "GET" ? undefined : Buffer.concat(chunks),
              redirect: "manual",
            });
            const returned = new Headers(r.headers);
            returned.delete("content-encoding");
            returned.delete("content-length");
            returned.delete("transfer-encoding");
            res.writeHead(r.status, Object.fromEntries(returned));
            res.end(Buffer.from(await r.arrayBuffer()));
          } catch {
            res.writeHead(503);
            res.end();
          }
        });
      },
    },
  ],
});
await server.listen();
