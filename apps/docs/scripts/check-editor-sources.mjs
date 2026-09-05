import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { documents, validateFile, validateNavigation, navigationLinks } from '../editor-policy.mjs';
const root = resolve(import.meta.dirname, '../../..');
const nav = validateNavigation(JSON.parse(await readFile(resolve(root, 'docs/navigation.json'), 'utf8')));
const paths = new Set(Object.values(documents).filter(doc => doc.path).map(doc => doc.path));
// Only the explicitly supported new-page folder participates; archives are never discovered.
for (const entry of await readdir(resolve(root, 'docs/guide'))) if (/^[a-z0-9-]+\.md$/.test(entry)) paths.add(`docs/guide/${entry}`);
for (const path of paths) {
  const info = await lstat(resolve(root, path));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${path}: only regular documents are supported`);
  try { validateFile(path, await readFile(resolve(root, path), 'utf8')); } catch (error) { throw new Error(`${path}: ${error.message}`); }
}
for (const link of navigationLinks(nav)) {
  const route = link.split('#')[0];
  if (!Object.values(documents).some(doc => doc.route === route) && !paths.has(`docs${route}.md`)) throw new Error(`Missing navigation destination: ${route}`);
}
console.log(`Validated ${paths.size} editable Markdown sources and navigation.`);
