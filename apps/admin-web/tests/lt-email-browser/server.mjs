import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const server=await createServer({configFile:false,root:fileURLToPath(new URL('./',import.meta.url)),plugins:[react()],server:{host:'127.0.0.1',port:18939,strictPort:true,fs:{allow:[process.cwd()]}}});await server.listen();server.printUrls();
