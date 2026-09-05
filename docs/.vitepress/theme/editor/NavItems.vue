<script setup>
import { ref } from 'vue';
defineProps({ items: Array, depth: { type: Number, default: 0 }, path: { type: Array, default: () => [] }, active: String, allowCreate: Boolean });
const emit = defineEmits(['change', 'open', 'create']);
const editing = ref(null);
function move(items, i, delta) { [items[i], items[i + delta]] = [items[i + delta], items[i]]; editing.value = null; emit('change'); }
function remove(items, i) {
  if (!confirm(`「${items[i].text}」を目次から削除しますか？記事の本文は削除されません。`)) return;
  items.splice(i, 1); editing.value = null; emit('change');
}
</script>
<template>
  <div class="nav-items" :class="{ 'nav-root': depth === 0 }">
    <div v-for="(item, i) in items" :key="i" class="nav-entry" :class="{ 'nav-section': item.items }">
      <div class="nav-row">
        <span v-if="item.items" class="nav-heading">{{ item.text }}</span>
        <button v-else class="nav-link" :class="{ active: active === item.link }" :aria-current="active === item.link ? 'page' : undefined" @click="emit('open', item.link)">{{ item.text }}</button>
        <button class="nav-settings" :aria-label="item.text + 'の設定'" :aria-expanded="editing === i" @click="editing = editing === i ? null : i">···</button>
      </div>
      <div v-if="editing === i" class="nav-item-settings">
        <label>表示名<input v-model="item.text" maxlength="80" @input="emit('change')"></label>
        <label v-if="!item.items">内部リンク<input v-model="item.link" placeholder="/guide/" @input="emit('change')"></label>
        <div class="toolbar"><button :disabled="i === 0" @click="move(items, i, -1)">↑ 上へ</button><button :disabled="i === items.length - 1" @click="move(items, i, 1)">↓ 下へ</button><button @click="remove(items, i)">削除</button></div>
      </div>
      <NavItems v-if="item.items" :items="item.items" :depth="depth + 1" :path="[...path, i]" :active="active" :allow-create="allowCreate" @change="emit('change')" @open="emit('open', $event)" @create="emit('create', $event)" />
    </div>
    <div class="nav-additions">
      <button v-if="allowCreate && depth > 0" class="nav-add" @click="emit('create', path)">＋ 新しいコンテンツを追加</button>
      <button v-if="depth === 0" class="nav-add" @click="items.push({ text: '新しいセクション', items: [] }); editing = items.length - 1; emit('change')">＋ 新しいセクションを追加</button>
      <details v-if="depth > 0 || !allowCreate" class="nav-add-options">
        <summary>その他の追加</summary>
        <button class="nav-add" @click="items.push({ text: '新しいリンク', link: '/guide/' }); editing = items.length - 1; emit('change')">＋ 既存ページのリンク</button>
        <button v-if="depth < 2" class="nav-add" @click="items.push({ text: '新しいセクション', items: [] }); editing = items.length - 1; emit('change')">＋ 子セクションを追加</button>
      </details>
    </div>
  </div>
</template>
