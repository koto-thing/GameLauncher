import { readFile, writeFile, cp, rm, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const origin = process.env.DOCS_ORIGIN || 'https://docs.invalid';
if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw new Error('Production origin must be HTTPS');
config.main = 'index.js'; config.assets.directory = 'assets'; delete config.$schema;
// This entrypoint is already bundled. Static files must stay in Assets,
// rather than being rediscovered as Worker modules by --no-bundle.
config.find_additional_modules = false;
config.vars = { DOCS_ORIGIN: origin, GITHUB_CLIENT_ID: process.env.DOCS_GITHUB_CLIENT_ID || '', DOCS_EDITING_ENABLED: process.env.DOCS_EDITING_ENABLED || 'false' };
config.d1_databases[0].database_id = process.env.DOCS_D1_ID || '00000000-0000-0000-0000-000000000000';
delete config.d1_databases[0].migrations_dir;
const directory = await realpath(new URL('../deploy/', import.meta.url));
const assets = fileURLToPath(new URL('../deploy/assets/', import.meta.url));
if (resolve(assets) !== resolve(directory, 'assets')) throw new Error('Deployment assets must remain within the local artifact directory');
const existing = await lstat(assets).catch(error => { if (error.code !== 'ENOENT') throw error; });
if (existing?.isSymbolicLink()) throw new Error('Deployment assets must not be a symlink');
await rm(assets, { recursive: true, force: true });
await cp(new URL('../../docs/dist/', import.meta.url), assets, { recursive: true });
await writeFile(new URL('../deploy/wrangler.json', import.meta.url), JSON.stringify(config, null, 2));
