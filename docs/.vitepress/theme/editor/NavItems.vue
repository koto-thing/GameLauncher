<script setup>
defineProps({ items: Array, depth: { type: Number, default: 0 } });
function move(items, i, delta) { [items[i], items[i + delta]] = [items[i + delta], items[i]]; }
</script>
<template>
  <fieldset v-for="(item, i) in items" :key="i">
    <legend>項目 {{ i + 1 }}</legend>
    <label>表示名<input v-model="item.text" maxlength="80"></label>
    <label v-if="!item.items">内部リンク<input v-model="item.link" placeholder="/guide/"></label>
    <div class="toolbar"><button :disabled="i === 0" @click="move(items, i, -1)">上へ</button><button :disabled="i === items.length - 1" @click="move(items, i, 1)">下へ</button><button @click="items.splice(i, 1)">項目を削除</button></div>
    <NavItems v-if="item.items" :items="item.items" :depth="depth + 1" />
  </fieldset>
  <div class="toolbar"><button @click="items.push({ text: '新しい項目', link: '/guide/' })">リンクを追加</button><button v-if="depth < 2" @click="items.push({ text: '新しい分類', items: [] })">分類を追加</button></div>
</template>
