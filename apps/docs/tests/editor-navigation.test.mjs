import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { navigationChanged, navigationText, documentIdForLink, sectionAt, withNewPage } from '../editor-navigation.mjs';

const source = readFileSync(new URL('../../../docs/navigation.json', import.meta.url), 'utf8');

test('sidebar links resolve directory index pages, anchors and newly created pages', () => {
  assert.equal(documentIdForLink('/'), 'index');
  assert.equal(documentIdForLink('/guide/#tools'), 'guide/index');
  assert.equal(documentIdForLink('/reference/'), 'reference/index');
  assert.equal(documentIdForLink('/guide/new-article'), 'guide/new-article');
});

test('navigation-only drafts detect rename, reorder and removal without false formatting changes', () => {
  const nav = JSON.parse(source);
  assert.equal(navigationChanged(nav, navigationText(nav).replaceAll('\n', '\r\n')), false);
  nav.sidebar['/guide/'][0].text = '開発ガイド';
  assert.equal(navigationChanged(nav, source), true);
  const restored = JSON.parse(JSON.stringify({ nav }));
  assert.equal(navigationChanged(restored.nav, source), true);
  const original = navigationText(nav);
  nav.sidebar['/guide/'].reverse();
  assert.equal(navigationChanged(nav, original), true);
  nav.sidebar['/guide/'].pop();
  assert.equal(navigationChanged(nav, original), true);
});

test('new content preserves draft sections, supports nested destinations, and does not mutate the draft', () => {
  const nav = JSON.parse(source);
  nav.sidebar['/guide/'].unshift({ text: '新設', items: [{ text: '子セクション', items: [] }] });
  const before = navigationText(nav);
  const next = withNewPage(nav, '/guide/', [0, 0], 'guide/new-article', '新しい資料');
  assert.deepEqual(sectionAt(next, '/guide/', [0, 0]).items, [{ text: '新しい資料', link: '/guide/new-article' }]);
  assert.equal(navigationText(nav), before);
  assert.throws(() => withNewPage(nav, '/guide/', [], 'guide/new-article', '新しい資料'));
  assert.throws(() => withNewPage(nav, '/guide/', [99], 'guide/new-article', '新しい資料'));
  assert.throws(() => withNewPage(nav, '/guide/', [0], '../escape', '新しい資料'));
});
