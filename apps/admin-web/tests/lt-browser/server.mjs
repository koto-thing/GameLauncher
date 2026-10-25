import { createServer } from "vite";
import react from "@vitejs/plugin-react";
const server = await createServer({ configFile: false, root: new URL("./", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1"), plugins: [react()], server: { host: "127.0.0.1", port: 4179, fs: { allow: [process.cwd(), new URL("../../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1")] } } });
await server.listen(); server.printUrls();
