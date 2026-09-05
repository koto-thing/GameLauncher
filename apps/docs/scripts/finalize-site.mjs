import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
const dist = resolve(import.meta.dirname, '../dist');
const base = process.env.DOCS_BASE_PATH || '/';
const origin = process.env.DOCS_ORIGIN || 'https://koto-thing.github.io';
if (new URL(origin).origin !== origin) throw new Error('DOCS_ORIGIN must be an origin without a path');
const commit = process.env.DOCS_COMMIT_SHA || process.env.GITHUB_SHA || 'local';
await writeFile(resolve(dist, 'version.json'), JSON.stringify({ commit, builtAt: new Date().toISOString() }) + '\n');
await writeFile(resolve(dist, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${origin}${base}sitemap.xml\n`);
const headers = [];
// Static Assets _headers apply without executing the Worker. Hash every trusted
// inline script (VitePress's appearance bootstrap and Doxygen) instead of unsafe-inline.
const { createHash } = await import('node:crypto');
const hashes = new Set();
async function walk(dir) { const result = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const path = resolve(dir, entry.name); if (entry.isDirectory()) result.push(...await walk(path)); else result.push(path); } return result; }
for (const file of await walk(dist)) if (file.endsWith('.html')) {
  let html = await readFile(file, 'utf8');
  const path = relative(dist, file).replaceAll('\\', '/');
  if (path.startsWith('reference/cpp/') || path === 'reference/admin/index.html') {
    if (!html.includes('id="pandd-reference-bar"')) html = html.replace(/<body([^>]*)>/, `<body$1><nav id="pandd-reference-bar" style="background:#242426;color:#ff6777;border-bottom:2px solid #ff6777;padding:10px 18px;font:14px system-ui"><a href="${base}reference/" style="color:#ffffff">← PandD マニュアルへ</a> · 自動生成のため本文は編集不可</nav>`);
    // Doxygen emits page-specific inline scripts. Extract them reproducibly so
    // the CSP stays short and does not need unsafe-inline for script execution.
    if (path.startsWith('reference/cpp/')) {
      const directory = resolve(dist, 'reference/cpp/_inline'); await mkdir(directory, { recursive: true });
      for (const match of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]) if (!/\bsrc=|type="application\/json"/.test(match[1]) && match[2].trim()) {
        const name = createHash('sha256').update(match[2]).digest('hex') + '.js';
        await writeFile(resolve(directory, name), match[2]);
        const src = relative(dirname(file), resolve(directory, name)).replaceAll('\\', '/');
        html = html.replace(match[0], `<script${match[1]} src="${src}"></script>`);
      }
      html = html.replace('href="javascript:searchBox.CloseResultsWindow()"', 'href="#" aria-label="検索結果を閉じる"');
      if (!html.includes('src="_inline/pandd-navigation.js"')) html = html.replace('</body>', '<script src="_inline/pandd-navigation.js" defer></script></body>');
      await writeFile(resolve(directory, 'pandd-navigation.js'), 'document.getElementById("MSearchClose")?.addEventListener("click", event => { event.preventDefault(); searchBox.CloseResultsWindow(); });\n');
    }
    await writeFile(file, html);
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\bsrc=|type="application\/json"/.test(match[1]) && match[2].trim()) hashes.add(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
}
const csp = `default-src 'self'; script-src 'self' ${[...hashes].join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://raw.githubusercontent.com; font-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`;
if (csp.length > 1800) throw new Error('Static CSP exceeds header length budget; split generated reference policies before deployment');
headers.push('/*', `  Content-Security-Policy: ${csp}`, '  X-Content-Type-Options: nosniff', '  Referrer-Policy: no-referrer', '  X-Frame-Options: DENY', '/version.json', '  Cache-Control: no-cache');
await writeFile(resolve(dist, '_headers'), headers.join('\n') + '\n');
const files = await walk(dist);
if (files.length > 20000) throw new Error('Workers Free asset count exceeded');
let bytes = 0;
for (const file of files) { const size = (await stat(file)).size; if (size > 25 * 1024 * 1024) throw new Error('Static Asset exceeds 25 MiB'); bytes += size; }
console.log(`Static artifact: ${files.length} files, ${bytes} bytes; ${hashes.size} inline script hashes.`);
