import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMarkdown, validateFile, validateNavigation, validPath, newDocumentPath, splitMarkdown, MAX_DOCUMENT_BYTES } from '../editor-policy.mjs';
test('safe Japanese Markdown round trips with CRLF, code, tables, relative links and metadata', () => {
  const source = '---\r\ntitle: 日本語\r\ndescription: 説明\r\n---\r\n# 本文\r\n\r\n[資料](./index.md)\r\n\r\n| 項目 | 内容 |\r\n| --- | --- |\r\n| 値 | 文章 |\r\n\r\n```html\r\n<script>{{ unsafe }}</script>\r\n<!-- @include: ../../secret -->\r\n```\r\n\r\n`{{ code }}`\r\n';
  assert.doesNotThrow(() => validateMarkdown(source)); const parsed = splitMarkdown(source); assert.equal(parsed.prefix + parsed.body, source);
});
for (const syntax of ['<script>alert(1)</script>','<style>body{display:none}</style>','<img src=x onerror=alert(1)>','<div v-html="evil"></div>','{{ globalThis }}','&#123;&#123; globalThis }}','<Component />','<!-- @include: ../../.env -->','<<< ../../.env','import x from "evil"','<iframe src="https://evil.test"></iframe>','<svg onload="alert(1)"></svg>','---\nhead:\n  - script\n---\ntext','---\nlayout: home\n---\ntext','```js :title="evil"\ntext\n```']) test(`rejects executable syntax: ${syntax.slice(0,35)}`, () => assert.throws(() => validateMarkdown(syntax)));
for (const path of ['../docs/a.md','docs/../a.md','docs\\a.md','docs/%2e%2e/a.md','docs/%252e/a.md','docs/.vitepress/config.mts','apps/a.md','.github/a.md','docs/guide/a.md.js','docs/guide/a.md\0']) test(`denies write path ${JSON.stringify(path)}`, () => assert.throws(() => validateFile(path,'# text')));
test('strict navigation schema and reserved/new routes', () => {
  const nav = JSON.parse(readFileSync(new URL('../../../docs/navigation.json', import.meta.url), 'utf8')); assert.doesNotThrow(() => validateNavigation(nav));
  for (const link of ['https://evil.test','//evil.test','/editor','/LUNA_IMPLEMENTATION_PLAN','/guide/%2e%2e']) { const changed = structuredClone(nav); changed.nav[0].link = link; assert.throws(() => validateNavigation(changed)); }
  const changed = structuredClone(nav); changed.nav[0].onClick = 'evil'; assert.throws(() => validateNavigation(changed));
  for (const id of ['editor','guide/index','guide/new-page']) { if(id !== 'editor') assert.ok(newDocumentPath(id)); else assert.throws(() => newDocumentPath(id)); }
  assert.equal(validPath('/absolute'), false);
});
test('home conversion preserves every original destination and unique source statement', () => {
  const source = readFileSync(new URL('../../../docs/index.md',import.meta.url),'utf8');
  const home = validateMarkdown(source, true);
  for (const link of ['/guide/','/reference/','/guide/launcher-development','/guide/admin-web-development','/architecture/trust-boundaries']) assert.ok(home.data.manual.entries.some(e => e.link === link));
  assert.match(source, /唯一の原本/);
});
test('rejects unknown YAML and aliases without removing them', () => {
  for (const yaml of ['title: one\ntitle: two','title: &a [*a]','title: x\nhead: []']) assert.throws(() => validateMarkdown(`---\n${yaml}\n---\ntext`));
});
test('maximum source is bounded', () => {
  assert.doesNotThrow(() => validateMarkdown('x'.repeat(MAX_DOCUMENT_BYTES)));
  assert.throws(() => validateMarkdown('x'.repeat(MAX_DOCUMENT_BYTES + 1)));
  assert.throws(() => validateMarkdown('['.repeat(513)));
});
