import MarkdownIt from 'markdown-it';
import { parseDocument, stringify } from 'yaml';
import manifest from './editor-manifest.json' with { type: 'json' };

export const MAX_DOCUMENT_BYTES = 16384;
export const MAX_FILES = 3;
export const documents = manifest;
export const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
const syntax = new MarkdownIt({ html: true, linkify: false });
export function requireValue(ok, message) { if (!ok) throw new Error(message); }
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
  requireValue(plain(value) && Object.keys(value).every(key => allowed.includes(key)), '未対応の項目があります。');
}
function label(value, max = 200) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f<>]|\{\{/.test(value), '項目名または文章が不正です。');
}
export function validPath(path) {
  return typeof path === 'string' && path.length <= 160 && !/[\\%\x00-\x20?#]/.test(path) && !path.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'));
}
export function newDocumentPath(id) {
  requireValue(/^guide\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 100, '新規ページは guide/ 内の英小文字・数字・ハイフンのslugを使用してください。');
  return `docs/${id}.md`;
}
export function documentPath(id, navigation) {
  if (Object.hasOwn(documents, id) && documents[id].path) return documents[id].path;
  const path = newDocumentPath(id);
  requireValue(navigation && navigationLinks(navigation).includes(`/${id}`), '編集対象に登録されていません。');
  return path;
}
export function navigationLinks(nav) {
  const result = [];
  const walk = items => { for (const item of items) { if (item.link) result.push(item.link); if (item.items) walk(item.items); } };
  walk(nav.nav); for (const items of Object.values(nav.sidebar)) walk(items);
  return result;
}
export function internalLink(link) {
  requireValue(typeof link === 'string' && /^\/(?!\/)[A-Za-z0-9_\-/]*(?:#[A-Za-z0-9_-]+)?$/.test(link), 'リンクは許可された内部URLを指定してください。');
  const route = link.split('#')[0];
  requireValue(Object.values(documents).some(doc => doc.route === route) || /^\/guide\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route), '非公開ナビゲーション対象や予約URLは指定できません。');
}
export function validateNavigation(value) {
  keys(value, ['nav', 'sidebar']);
  let count = 0;
  const items = (list, depth = 0) => {
    requireValue(Array.isArray(list) && list.length <= 40 && depth <= 2, '目次の件数または階層が上限を超えています。');
    for (const item of list) {
      requireValue(++count <= 120, '目次は120項目までです。');
      keys(item, ['text', 'link', 'items']); label(item.text, 80);
      requireValue(Boolean(item.link) !== Boolean(item.items), 'リンクまたは子項目のどちらかを指定してください。');
      if (item.link) internalLink(item.link); else items(item.items, depth + 1);
    }
  };
  items(value.nav);
  requireValue(plain(value.sidebar) && Object.keys(value.sidebar).length <= 8, 'サイドバーが不正です。');
  for (const [prefix, list] of Object.entries(value.sidebar)) {
    requireValue(['/', '/guide/', '/architecture/', '/reference/'].includes(prefix), '未対応の目次配置先です。'); items(list);
  }
  return value;
}
export function splitMarkdown(source) {
  requireValue(typeof source === 'string' && new TextEncoder().encode(source).length <= MAX_DOCUMENT_BYTES, '原稿は16KiBまでです。');
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return { data: {}, body: source, prefix: '' };
  requireValue(match[1].length <= 8192, 'frontmatterが大きすぎます。');
  const parsed = parseDocument(match[1], { uniqueKeys: true, maxAliasCount: 0 });
  requireValue(parsed.errors.length === 0, 'frontmatterのYAMLが不正です。');
  const data = parsed.toJS({ maxAliasCount: 0 });
  requireValue(plain(data), 'frontmatterは項目と値で指定してください。');
  return { data, body: source.slice(match[0].length), prefix: match[0] };
}
export function validateMarkdown(source, home = false) {
  requireValue(!/(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\bgh[upsr]_[A-Za-z0-9]{30,}|X-Amz-(?:Credential|Signature)=)/i.test(source), '秘密情報に似た値が含まれています。保存を停止しました。');
  const { data, body } = splitMarkdown(source);
  requireValue((body.match(/\[/g) || []).length <= 512 && body.split('\n').length <= 600, '構文量が上限を超えています。記事を分割してください。');
  keys(data, home ? ['title', 'description', 'manual'] : ['title', 'description']);
  for (const key of ['title', 'description']) if (data[key] !== undefined) label(data[key], key === 'title' ? 160 : 500);
  if (home) {
    keys(data.manual, ['title', 'description', 'entries']); label(data.manual.title); label(data.manual.description, 500);
    requireValue(Array.isArray(data.manual.entries) && data.manual.entries.length > 0 && data.manual.entries.length <= 12, 'ホーム目次は1〜12項目です。');
    for (const entry of data.manual.entries) { keys(entry, ['title', 'description', 'link']); label(entry.title); label(entry.description, 500); internalLink(entry.link); }
  }
  // Inspect parsed syntax, leaving fenced and inline code completely untouched.
  const inspect = tokens => {
    for (const token of tokens) {
      if (token.type === 'fence') { requireValue(/^[a-zA-Z0-9_-]*(?:\s+\{[0-9, -]+\})?$/.test(token.info.trim()), 'コードフェンスの言語指定が未対応です。'); continue; }
      if (token.type === 'code_block' || token.type === 'code_inline') continue;
      requireValue(!['html_block', 'html_inline'].includes(token.type), 'HTML・Vueは編集できません。コード例はコードフェンス内に記載してください。');
      if (['inline', 'text'].includes(token.type)) requireValue(!/\{\{|\}\}|<!--\s*@include|(?:^|\n)\s*(?:<<<|import\s|export\s)/.test(token.type === 'inline' ? '' : token.content), 'テンプレート式・include・importは使用できません。');
      for (const [name, value] of token.attrs || []) if (['href', 'src'].includes(name)) {
        requireValue(!/[\x00-\x20\\]|^\/\//.test(value) && !/^(?!https?:|mailto:)[a-z][a-z0-9+.-]*:/i.test(value), '危険なリンクです。');
        if (name === 'src') requireValue(manifest.$images.paths.includes(value), '画像は既存の許可済み画像のみ参照できます。');
      }
      if (token.children) inspect(token.children);
    }
  };
  inspect(syntax.parse(body, {}));
  return { data, body };
}
export function composeMarkdown(data, body) { return `---\n${stringify(data)}---\n${body}`; }
export function validateFile(path, content) {
  requireValue(validPath(path), '不正なパスです。');
  if (path === 'docs/navigation.json') {
    requireValue(new TextEncoder().encode(content).length <= MAX_DOCUMENT_BYTES, '目次が大きすぎます。');
    return validateNavigation(JSON.parse(content));
  }
  requireValue(Object.values(documents).some(doc => doc.path === path) || /^docs\/guide\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path), '編集を許可されていないファイルです。');
  return validateMarkdown(content, path === 'docs/index.md');
}
