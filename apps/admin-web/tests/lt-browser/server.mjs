import { createServer } from "vite";
import react from "@vitejs/plugin-react";
const server = await createServer({ configFile: false, root: new URL("./", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1"), plugins: [react()], server: { host: "127.0.0.1", port: Number(process.env.LT_BROWSER_PORT ?? 4179), strictPort: true, fs: { allow: [process.cwd(), new URL("../../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1")] } } });
await server.listen(); server.printUrls();
