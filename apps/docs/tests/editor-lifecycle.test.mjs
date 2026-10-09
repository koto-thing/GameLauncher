import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ref, computed, toRaw, nextTick } from 'vue';
import * as navigation from '../editor-navigation.mjs';
import * as policy from '../editor-policy.mjs';

const source = (await readFile(new URL('../../../docs/.vitepress/theme/editor/Editor.vue', import.meta.url), 'utf8')).split('<script setup>')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm, '');

// Exercise the real editor state transitions with deterministic API responses
function editor(latest, respond) {
  const calls = [];
  const dependencies = { ref, computed, toRaw, nextTick, watch() {}, onMounted() {}, onBeforeUnmount() {}, useData: () => ({ isDark: ref(false) }), withBase: value => value, ...navigation, ...policy, fetch: async (url, options) => {
    calls.push(url);
    if (respond) { const response = respond(url, options); if (response) return response; }
    return Response.json(url.includes('/changes/') ? { changeClosed: true } : latest);
  } };
  const state = new Function(...Object.keys(dependencies), source + '\nreturn { save, prepareChange, createPage, useLatestBase, source, original, loaded, nav, change, pending, isNew, slug, newTitle, section, conflict, status, selected };')(...Object.values(dependencies));
  state.loaded.value = { ...latest, head: 'old-head' };
  state.source.value = state.original.value = latest.content;
  state.nav.value = JSON.parse(latest.navigation.content);
  state.change.value = { id: 'closed-pr' };
  return { state, calls };
}

const nav = { nav: [], sidebar: { '/guide/': [{ text: 'リリース', items: [] }] } };
const latest = { head: 'latest-head', sha: 'latest-sha', content: '# 公開済み\n', editable: true, navigation: { sha: 'nav-sha', content: JSON.stringify(nav) } };

test('closed PR detaches while preserving unsaved article and navigation edits', async () => {
  const { state } = editor(latest);
  state.source.value = '# 未保存\n';
  state.nav.value.sidebar['/guide/'][0].text = '編集した目次';
  assert.equal(await state.prepareChange(), true);
  assert.equal(state.change.value, null);
  assert.equal(state.loaded.value.head, latest.head);
  assert.equal(state.source.value, '# 未保存\n');
  assert.equal(state.nav.value.sidebar['/guide/'][0].text, '編集した目次');
});

test('new page recovery fetches navigation instead of the internal $new route', async () => {
  const { state, calls } = editor(latest);
  state.isNew.value = true; state.selected.value = '$new'; state.slug.value = 'new-page'; state.newTitle.value = '新しい記事';
  state.original.value = ''; state.source.value = '# 新しい記事\n'; state.section.value = [0];
  assert.equal(await state.prepareChange(), true);
  assert.equal(state.loaded.value.sha, null);
  assert.equal(state.original.value, '');
  assert.equal(state.source.value, '# 新しい記事\n');
  assert.deepEqual(state.section.value, [0]);
  assert.ok(calls.includes('/api/docs/page?documentId=%24navigation'));
  assert.equal(calls.some(url => url.includes('$new')), false);
});

test('concurrent article changes require comparison before detaching', async () => {
  const { state } = editor(latest);
  state.original.value = '# 古い原稿\n'; state.source.value = '# 自分の原稿\n';
  assert.equal(await state.prepareChange(), false);
  assert.equal(state.status.value, 'conflict');
  assert.equal(state.conflict.value.current, latest.content);
  assert.equal(state.source.value, '# 自分の原稿\n');
  assert.equal(state.change.value.id, 'closed-pr');
  state.useLatestBase();
  assert.equal(state.change.value, null);
  assert.equal(state.original.value, latest.content);
});

test('unchanged article follows latest master without reverting newer content', async () => {
  const { state } = editor(latest);
  state.source.value = state.original.value = '# 古い原稿\n';
  assert.equal(await state.prepareChange(), true);
  assert.equal(state.source.value, latest.content);
});

test('ambiguous save retains original operation and change until reconciled', async () => {
  const { state, calls } = editor(latest);
  state.pending.value = { changeId: 'closed-pr', body: { key: 'same-key' } };
  await state.prepareChange();
  assert.equal(state.pending.value.body.key, 'same-key');
  assert.equal(state.change.value.id, 'closed-pr');
  assert.equal(calls.length, 1);
});


test('PR closed between review and save releases rejected operation and keeps draft', async () => {
  const { state } = editor(latest, (url, options) => options.method === 'PATCH' ? Response.json({ error: 'closed', details: { changeClosed: true, discardOperation: true } }, { status: 409 }) : null);
  state.source.value = '# 保存したい原稿\n';
  state.pending.value = { changeId: 'closed-pr', body: { key: 'rejected-key' } };
  await state.save();
  assert.equal(state.pending.value, null);
  assert.equal(state.change.value, null);
  assert.equal(state.source.value, '# 保存したい原稿\n');
  assert.equal(state.loaded.value.head, latest.head);
});

test('concurrent navigation changes require explicit comparison', async () => {
  const { state } = editor(latest);
  state.loaded.value.navigation = { content: JSON.stringify({ ...nav, nav: [{ text: '元', link: '/guide/' }] }) };
  state.nav.value.nav = [{ text: '自分', link: '/guide/' }];
  assert.equal(await state.prepareChange(), false);
  assert.equal(state.conflict.value.latest.navigation.content, latest.navigation.content);
  assert.equal(state.nav.value.nav[0].text, '自分');
});

test('unmerged closed PR keeps its saved content for comparison instead of discarding it', async () => {
  const { state } = editor(latest, url => url.includes('/changes/') ? Response.json({ state: 'conflict', changeClosed: true }) : null);
  state.source.value = state.original.value = '# PRだけに保存された原稿\n';
  assert.equal(await state.prepareChange(), false);
  assert.equal(state.source.value, '# PRだけに保存された原稿\n');
  state.useLatestBase();
  assert.equal(state.change.value, null);
  assert.equal(state.source.value, '# PRだけに保存された原稿\n');
});
