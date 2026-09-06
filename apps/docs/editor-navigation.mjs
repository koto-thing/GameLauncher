import { documents, validateNavigation, newDocumentPath } from './editor-policy.mjs';

export const navigationText = value => JSON.stringify(value, null, 2) + '\n';
export const navigationChanged = (value, original) => Boolean(value && original && JSON.stringify(value) !== JSON.stringify(JSON.parse(original)));
export function documentIdForLink(link) {
  const route = link.split('#')[0];
  return Object.entries(documents).find(([, doc]) => doc.route === route)?.[0] || route.slice(1);
}
export function sectionAt(navigation, prefix, path) {
  let items = navigation.sidebar[prefix];
  let section;
  for (const index of path) { section = items?.[index]; items = section?.items; }
  if (!section || !Array.isArray(items)) throw new Error('目次の配置先を選んでください。');
  return section;
}
export function withNewPage(navigation, prefix, path, id, title) {
  newDocumentPath(id);
  if (!title.trim()) throw new Error('目次の表示名を入力してください。');
  const result = structuredClone(navigation);
  sectionAt(result, prefix, path).items.push({ text: title.trim(), link: `/${id}` });
  return validateNavigation(result);
}
