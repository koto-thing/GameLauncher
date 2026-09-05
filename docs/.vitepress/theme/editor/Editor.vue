<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { withBase } from 'vitepress';
import DOMPurify from '../../../../apps/docs/node_modules/dompurify/dist/purify.es.mjs';
import { diffLines } from '../../../../apps/docs/node_modules/diff/libesm/index.js';
import { documents, splitMarkdown, composeMarkdown, validateMarkdown, validateNavigation, navigationLinks, newDocumentPath, markdown } from '../../../../apps/docs/editor-policy.mjs';
import NavItems from './NavItems.vue';

const session = ref(null), loaded = ref(null), source = ref(''), original = ref(''), selected = ref('index');
const picker = ref('index');
const busy = ref(false), error = ref(''), notice = ref(''), change = ref(null), draft = ref(null), pending = ref(null);
const status = ref('unsaved'), statusMessage = ref(''), review = ref(false), acknowledged = ref(false), logoutChoice = ref(false);
const isNew = ref(false), slug = ref(''), newTitle = ref(''), section = ref(0), textArea = ref(null);
const home = ref(null), nav = ref(null), conflict = ref(null), preview = ref(''), differences = ref([]);
const canCorrect = ref(false);
let draftTimer, pollTimer, polls = 0;
const choices = computed(() => { const result = Object.fromEntries(Object.entries(documents).filter(([,doc]) => doc.path)); if (loaded.value?.navigation) for (const route of navigationLinks(JSON.parse(loaded.value.navigation.content))) { const id = route.slice(1); if (/^guide\/[a-z0-9-]+$/.test(id) && !result[id]) result[id] = {path: 'docs/' + id + '.md',route}; } return result; });
const id = computed(() => isNew.value ? `guide/${slug.value}` : selected.value);
const dirty = computed(() => source.value !== original.value || Boolean(pending.value));
const labels = { unsaved: '未保存', saved: '保存済み', checking: '検証中', ready: '公開可能', publishing: '公開処理中', published: '公開済み', validation_failed: '検証失敗', awaiting_approval: '承認待ち', conflict: '競合あり', deploy_failed: '配信失敗' };
const draftKey = () => `pandd-docs-draft:${session.value?.user?.id}:${selected.value}`;
const loginUrl = computed(() => `/api/docs/auth/start?returnTo=${encodeURIComponent('/editor?documentId=' + selected.value)}`);
const publicUrl = computed(() => withBase(selected.value === '$navigation' || isNew.value ? '/guide/' : documents[selected.value]?.route || `/${selected.value}`));

async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/docs${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': session.value?.csrf || '' } : {}) }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('この公開先には編集APIがありません。管理者によるCloudflare設定待ちです。');
  const value = await response.json();
  if (!response.ok) { const error = new Error(`${value.error}（照会ID: ${value.requestId || '取得不可'}）`); error.status = response.status; error.details = value.details; throw error; }
  return value;
}
async function run(action) { busy.value = true; error.value = ''; canCorrect.value = false; try { await action(); } catch (e) { error.value = e.message; canCorrect.value = Boolean(e.details?.discardOperation); if (e.status === 409) { status.value = 'conflict'; conflict.value = e.details || {}; } } finally { busy.value = false; } }
function refreshForms() {
  home.value = null; nav.value = null;
  try { if (selected.value === '$navigation') nav.value = JSON.parse(source.value); else if (selected.value === 'index') home.value = splitMarkdown(source.value).data; } catch { /* Invalid source stays visible and cannot be saved. */ }
}
function editHome() { source.value = composeMarkdown(home.value, splitMarkdown(source.value).body); }
function editNav() { source.value = JSON.stringify(nav.value, null, 2) + '\n'; }
function metadata(key, event) { const parsed = splitMarkdown(source.value); if (event.target.value) parsed.data[key] = event.target.value; else delete parsed.data[key]; source.value = composeMarkdown(parsed.data, parsed.body); }
function meta(key) { try { return splitMarkdown(source.value).data[key] || ''; } catch { return ''; } }
function remember() {
  if (!session.value?.authenticated || !loaded.value || draft.value) return;
  try { localStorage.setItem(draftKey(), JSON.stringify({ source: source.value, original: original.value, loaded: loaded.value, change: change.value, pending: pending.value, isNew: isNew.value, slug: slug.value, newTitle: newTitle.value, section: section.value })); if (dirty.value) notice.value = 'この端末に復旧用下書きを保存しました。GitHubへの保存ではありません。'; }
  catch { notice.value = '端末の下書きを保存できません。離れる前に文章をコピーしてください。'; }
}
watch(source, () => { review.value = false; acknowledged.value = false; clearTimeout(draftTimer); draftTimer = setTimeout(remember, 700); });
watch([slug, newTitle, section], () => { review.value = false; acknowledged.value = false; clearTimeout(draftTimer); draftTimer = setTimeout(remember, 700); });
function restore() {
  const value = draft.value;
  source.value = value.source; original.value = value.original; loaded.value = value.loaded; change.value = value.change; pending.value = value.pending;
  isNew.value = value.isNew; slug.value = value.slug; newTitle.value = value.newTitle; section.value = value.section;
  refreshForms(); draft.value = null; notice.value = '端末の下書きを復旧しました。古い原稿が基準の場合、保存時に競合を検出します。';
}
function discardDraft() { localStorage.removeItem(draftKey()); draft.value = null; }
async function loadDocument() {
  if (dirty.value && !confirm('未保存の文章を端末に残して、別の原稿を開きますか？')) return;
  remember(); selected.value = picker.value; clearTimeout(pollTimer); change.value = null; pending.value = null; conflict.value = null; draft.value = null; isNew.value = false; review.value = false; statusMessage.value = '';
  await run(async () => {
    loaded.value = await api(`/page?documentId=${encodeURIComponent(selected.value)}`);
    source.value = loaded.value.content; original.value = source.value; refreshForms(); status.value = 'unsaved';
    try { draft.value = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch { draft.value = null; }
    if (draft.value?.source === source.value && !draft.value?.pending) draft.value = null;
    const version = await fetch(withBase('/version.json'), { cache: 'no-store' }).then(response => response.ok ? response.json() : null).catch(() => null);
    notice.value = version?.commit === loaded.value.head ? 'GitHubの最新原稿を取得しました。' : 'GitHubの最新原稿を取得しました。表示中の公開版とは版が異なる可能性があります。';
  });
}
async function createPage() {
  if (dirty.value && !confirm('現在の編集を端末に残して新規ページを作りますか？')) return;
  remember();
  await run(async () => {
    const latest = await api('/page?documentId=$navigation'); loaded.value = { ...latest, sha: null, content: '' };
    selected.value = '$new'; picker.value = '$new'; isNew.value = true; slug.value = ''; newTitle.value = ''; source.value = '# 新しいページ\n\n'; original.value = ''; change.value = null; pending.value = null; home.value = null; nav.value = null; review.value = false;
    clearTimeout(pollTimer); status.value = 'unsaved'; statusMessage.value = ''; conflict.value = null;
    try { draft.value = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch { draft.value = null; }
  });
}
function insert(before, after = '') {
  const area = textArea.value; if (!area) return; area.focus();
  // Native editing commands preserve the textarea's Undo/Redo history, including IME text.
  const selectedText = area.value.slice(area.selectionStart, area.selectionEnd);
  document.execCommand('insertText', false, before + selectedText + after); source.value = area.value;
}
function showReview() {
  error.value = '';
  try {
    if (selected.value === '$navigation') validateNavigation(JSON.parse(source.value)); else validateMarkdown(source.value, selected.value === 'index');
    const escape = markdown.utils.escapeHtml;
    const links = items => `<ul>${items.map(item => `<li>${item.link ? `<a href="${escape(withBase(item.link))}">${escape(item.text)}</a>` : escape(item.text)}${item.items ? links(item.items) : ''}</li>`).join('')}</ul>`;
    let html;
    if (selected.value === '$navigation') {
      const value = JSON.parse(source.value);
      html = '<h1>ナビゲーション</h1>' + links(value.nav) + Object.entries(value.sidebar).map(([path, items]) => `<h2>${escape(path)}</h2>${links(items)}`).join('');
    } else {
      const parsed = splitMarkdown(source.value);
      html = markdown.render(parsed.body);
      if (selected.value === 'index') {
        const manual = parsed.data.manual;
        html = `<h1>${escape(manual.title)}</h1><p>${escape(manual.description)}</p><ol>${manual.entries.map(entry => `<li><a href="${escape(withBase(entry.link))}">${escape(entry.title)}</a><p>${escape(entry.description)}</p></li>`).join('')}</ol>` + html;
      }
    }
    const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    const base = new URL(publicUrl.value, location.origin).href.replaceAll('&','&amp;').replaceAll('"','&quot;');
    preview.value = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri ${location.origin}; form-action 'none'"><base href="${base}"><style>body{font:16px/1.9 system-ui,sans-serif;color:#303034;background:#fafafb;padding:18px;overflow-wrap:anywhere}pre,table{display:block;overflow:auto}pre{background:#e9e9ed;padding:12px}a{color:#b52f48}h1{font-size:26px}</style></head><body>${safe}</body></html>`;
    differences.value = diffLines(original.value, source.value, { timeout: 1000, maxEditLength: 2000 }) || [{ value: '差分が大きすぎます。原文と編集後の全文を比較してください。' }];
    if (isNew.value) {
      const navigation = payload().files.find(file => file.documentId === '$navigation');
      differences.value.push({ value: '\n── 目次の同時変更 ──\n' }, ...(diffLines(loaded.value.navigation.content, navigation.content, { timeout: 1000, maxEditLength: 2000 }) || [{ value: navigation.content, added: true }]));
    }
    review.value = true;
  } catch (e) { error.value = e.message; }
}
function payload() {
  const files = [{ documentId: id.value, content: source.value, sha: loaded.value.sha, ...(isNew.value ? { create: true } : {}) }];
  if (isNew.value) {
    newDocumentPath(id.value);
    if (!slug.value || !newTitle.value.trim()) throw new Error('slugと目次の表示名を入力してください。');
    const navigation = JSON.parse(loaded.value.navigation.content);
    const target = navigation.sidebar['/guide/'][section.value]; if (!target?.items) throw new Error('目次の配置先を選んでください。');
    target.items.push({ text: newTitle.value, link: `/${id.value}` }); validateNavigation(navigation);
    files.push({ documentId: '$navigation', content: JSON.stringify(navigation, null, 2) + '\n', sha: loaded.value.navigation.sha });
  }
  return { key: crypto.randomUUID(), head: loaded.value.head, files };
}
async function save() {
  await run(async () => {
    if (!pending.value) pending.value = { changeId: change.value?.id, body: payload() };
    remember();
    const operation = pending.value;
    const result = await api(operation.changeId ? `/changes/${operation.changeId}` : '/changes', operation.changeId ? 'PATCH' : 'POST', operation.body);
    change.value = result; status.value = 'saved';
    const savedId = id.value;
    const latest = await api(`/changes/${result.id}?documentId=${encodeURIComponent(savedId)}`);
    loaded.value = latest; original.value = latest.content;
    selected.value = savedId; picker.value = savedId; isNew.value = false; pending.value = null; notice.value = 'GitHubへ保存し、原稿の一致を確認しました。まだ一般公開されていません。';
    remember(); polls = 0; schedulePoll();
  });
}
async function refreshStatus() {
  if (!change.value) return;
  const result = await api(`/changes/${change.value.id}`); status.value = result.state; statusMessage.value = result.message; change.value = { ...change.value, ...result };
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (++polls > 20 || ['published','validation_failed','deploy_failed','conflict','awaiting_approval','ready'].includes(status.value)) return;
  pollTimer = setTimeout(async () => { if (document.visibilityState !== 'visible') return; try { await refreshStatus(); schedulePoll(); } catch (e) { error.value = e.message; } }, 15000);
}
async function publish() { await run(async () => { const result = await api(`/changes/${change.value.id}/publish`, 'POST', { head: change.value.head }); status.value = result.state; statusMessage.value = 'masterへ反映しました。ビルド・配信結果を確認しています。'; polls = 0; schedulePoll(); }); }
async function compareLatest() {
  await run(async () => { const latest = await api(`/page?documentId=${encodeURIComponent(selected.value)}`); conflict.value = { current: latest.content, latest }; });
}
function useLatestBase() {
  loaded.value = conflict.value.latest; original.value = loaded.value.content; change.value = null; pending.value = null; conflict.value = null; status.value = 'unsaved'; review.value = false;
  notice.value = '自分の文章を残して最新版を比較元にしました。差分を調整し、新しい変更として保存してください。';
}
async function logout(keep) {
  await run(async () => {
    clearTimeout(draftTimer); if (keep) remember();
    await api('/logout', 'POST', {});
    if (!keep) for (const key of Object.keys(localStorage)) if (key.startsWith(`pandd-docs-draft:${session.value.user.id}:`)) localStorage.removeItem(key);
    clearTimeout(pollTimer); loaded.value = null; pending.value = null; source.value = ''; original.value = ''; session.value = null; logoutChoice.value = false;
  });
}
function leaving(event) { if (dirty.value) { remember(); event.preventDefault(); event.returnValue = ''; } }
function linkLeaving(event) { const link = event.target.closest?.('a'); if (dirty.value && link?.href && !link.hash && !confirm('未保存の文章を端末に残して移動しますか？')) event.preventDefault(); }
onMounted(async () => {
  const query = new URLSearchParams(location.search).get('documentId'); if (query) { selected.value = query; picker.value = query; }
  window.addEventListener('beforeunload', leaving); document.addEventListener('click', linkLeaving, true);
  await run(async () => { try { session.value = await api('/session'); } catch (e) { if (e.status !== 401) throw e; session.value = { configured: true, authenticated: false }; } });
  if (session.value?.authenticated) await loadDocument();
});
onBeforeUnmount(() => { clearTimeout(draftTimer); clearTimeout(pollTimer); remember(); window.removeEventListener('beforeunload', leaving); document.removeEventListener('click', linkLeaving, true); });
</script>

<template>
  <section class="editor" :aria-busy="busy">
    <div class="title-bar">PandD Documentation / 編集室</div>
    <p v-if="error" role="alert" class="notice error">{{ error }}</p>
    <div v-if="!session?.authenticated" class="panel">
      <p>{{ session?.message || '公開資料はログインなしで閲覧できます。編集するにはGitHubでログインしてください。' }}</p>
      <a v-if="session?.configured" class="button primary" :href="loginUrl" target="_self">GitHubでログイン</a>
      <a class="button" :href="withBase('/')">マニュアルへ戻る</a>
    </div>
    <template v-else>
      <div class="toolbar"><span>{{ session.user.login }}</span><button @click="logoutChoice = !logoutChoice">ログアウト</button></div>
      <div v-if="logoutChoice" class="notice"><p>この端末の下書きをどうしますか？</p><div class="toolbar"><button @click="logout(true)">保持してログアウト</button><button @click="logout(false)">削除してログアウト</button></div></div>
      <div class="panel">
        <label>編集する資料<select v-model="picker" :disabled="busy"><option v-for="(doc, key) in choices" :key="key" :value="key">{{ key }}</option><option value="$navigation">ナビゲーション</option><option v-if="isNew" value="$new">新規ページ</option></select></label>
        <div class="toolbar"><button :disabled="busy" @click="loadDocument">原稿を開く</button><button :disabled="busy" @click="createPage">新規ページ</button><a :href="publicUrl" target="_blank" rel="noopener">公開記事を確認</a></div>
      </div>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <div v-if="draft" class="notice"><p>この端末に復旧用下書きがあります。GitHubには保存されていない可能性があります。</p><button @click="restore">下書きを復旧</button><button @click="discardDraft">最新原稿を使う</button></div>
      <template v-if="loaded">
        <p v-if="!loaded.editable" class="notice error">この原稿はWeb編集できません：{{ loaded.reason }}</p>
        <fieldset :disabled="busy || !loaded.editable || Boolean(pending) || Boolean(draft)">
          <div v-if="isNew" class="panel">
            <label>slug（guide/ 内）<input v-model="slug" placeholder="new-guide" maxlength="80"></label>
            <label>目次の表示名<input v-model="newTitle" maxlength="80"></label>
            <label>目次の配置先<select v-model="section"><option v-for="(item, i) in JSON.parse(loaded.navigation.content).sidebar['/guide/']" :key="i" :value="i">{{ item.text }}</option></select></label>
          </div>
          <div v-if="home" @input="editHome">
            <label>ホーム見出し<input v-model="home.manual.title"></label><label>ホーム説明<textarea v-model="home.manual.description" rows="3"></textarea></label>
            <fieldset v-for="(entry, i) in home.manual.entries" :key="i"><legend>導線 {{ i + 1 }}</legend><label>見出し<input v-model="entry.title"></label><label>説明<textarea v-model="entry.description" rows="2"></textarea></label><label>内部リンク<input v-model="entry.link"></label><button @click="home.manual.entries.splice(i, 1); editHome()">導線を削除</button></fieldset>
            <button @click="home.manual.entries.push({title:'新しい導線',description:'資料の説明',link:'/guide/'}); editHome()">導線を追加</button>
          </div>
          <div v-if="nav" @input="editNav" @click="nextTick(editNav)">
            <details open><summary>上部メニュー</summary><NavItems :items="nav.nav" /></details>
            <details v-for="(items, prefix) in nav.sidebar" :key="prefix"><summary>サイドバー {{ prefix }}</summary><NavItems :items="items" /></details>
          </div>
          <template v-else>
            <label>ページタイトル<input :value="meta('title')" @change="metadata('title', $event)"></label><label>説明<input :value="meta('description')" @change="metadata('description', $event)"></label>
            <template v-if="!home">
              <div class="toolbar" role="group" aria-label="Markdown整形"><button @click="insert('## ')">見出し</button><button @click="insert('**', '**')">太字</button><button @click="insert('[', '](/guide/)')">リンク</button><button @click="insert('\n| 項目 | 説明 |\n| --- | --- |\n| 値 | 内容 |\n')">表</button><button @click="insert('\n```text\n', '\n```\n')">コード</button><button @click="insert('![説明](/images/pandd-logo.png)')">画像参照</button></div>
              <label for="docs-source">Markdown原稿</label><textarea id="docs-source" ref="textArea" v-model="source" rows="20" spellcheck="false" autocapitalize="off"></textarea>
            </template>
            <template v-else><label>ホーム本文<textarea :value="splitMarkdown(source).body" rows="8" @input="source = composeMarkdown(home, $event.target.value)"></textarea></label></template>
          </template>
        </fieldset>
        <p class="state" role="status">{{ dirty && status !== 'unsaved' ? '未保存 · ' : '' }}{{ labels[status] }} <span>{{ statusMessage }}</span></p>
        <div class="toolbar"><button :disabled="busy || !loaded.editable" @click="showReview">プレビュー・差分を確認</button><button v-if="change" :disabled="busy" @click="run(refreshStatus)">検証・配信状態を更新</button><a v-if="change?.prUrl" :href="change.prUrl" target="_blank" rel="noopener">PR詳細</a></div>
        <div v-if="review" class="panel">
          <div class="split"><div><h3>プレビュー</h3><iframe title="原稿プレビュー" sandbox="" :srcdoc="preview"></iframe></div><div><h3>差分</h3><pre class="diff"><span v-for="(part, i) in differences" :key="i" :class="{ added: part.added, removed: part.removed }">{{ part.added ? '+ ' : part.removed ? '− ' : '  ' }}{{ part.value }}</span></pre></div></div>
          <p class="notice">保存すると公開リポジトリのブランチ・PRに文章が公開されます。非公開の下書きではありません。秘密情報を書かないでください。</p>
          <label><input v-model="acknowledged" type="checkbox"> 差分と公開性を確認しました</label>
          <div class="toolbar"><button class="primary" :disabled="busy || !acknowledged || !dirty || Boolean(pending)" @click="save">変更を保存</button><button :disabled="busy || status !== 'ready' || dirty" @click="publish">公開</button></div>
        </div>
        <div v-if="pending" class="notice"><p>保存結果の確認が必要です。内容を変えずに同じ操作を再試行してください。</p><button :disabled="busy" @click="save">保存結果を照合・再試行</button><button v-if="canCorrect" @click="pending = null; canCorrect = false; review = false">未保存を確認済み：入力を修正</button></div>
        <div v-if="status === 'conflict'" class="panel"><h3>競合の比較</h3><p>元の内容と自分の文章を残しています。最新の内容を確認してから差分を調整してください。</p><button @click="compareLatest">最新原稿を取得して比較</button><div class="split"><details><summary>編集開始時の内容</summary><pre>{{ original }}</pre></details><details><summary>自分の編集</summary><pre>{{ source }}</pre></details></div><details v-if="conflict?.current" open><summary>最新の内容</summary><pre>{{ conflict.current }}</pre></details><button v-if="conflict?.latest" @click="useLatestBase">自分の文章を残し、最新版を比較元にする</button></div>
      </template>
    </template>
  </section>
</template>
