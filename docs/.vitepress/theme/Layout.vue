<script setup>
import DefaultTheme from 'vitepress/theme';
import { useData, withBase } from 'vitepress';
import { computed, defineAsyncComponent } from 'vue';
import manifest from '../../../apps/docs/editor-manifest.json';
import ManualHome from './ManualHome.vue';
const { page, frontmatter, theme } = useData();
const id = computed(() => page.value.relativePath.replace(/\.md$/, ''));
const isEditor = computed(() => page.value.relativePath === 'editor.md');
const editable = computed(() => Object.hasOwn(manifest, id.value) || /^guide\/[a-z0-9-]+$/.test(id.value));
const Editor = defineAsyncComponent(() => import('./editor/Editor.vue'));
const editorUrl = computed(() => withBase('/editor') + (editable.value ? '?documentId=' + encodeURIComponent(id.value) : ''));
</script>
<template>
  <DefaultTheme.Layout>
    <template #nav-bar-title-after><span class="window-label">DOCUMENTATION</span></template>
    <template #nav-bar-content-after><a class="manual-login" :href="editorUrl">{{ isEditor ? 'EDIT MODE' : 'ログイン / 編集' }}</a></template>
    <template #page-top><ClientOnly><Editor v-if="isEditor" /></ClientOnly></template>
    <template #doc-before><ManualHome v-if="frontmatter.manual" /><div v-else class="document-label"><span>{{ isEditor ? '// EDITOR.EXE' : '// PANDD_DOCUMENTATION' }}</span><span>{{ isEditor ? 'WRITE MODE' : 'READ MODE' }}</span></div></template>
    <template #doc-after>
      <div v-if="!isEditor" class="manual-edit"><a v-if="editable" :href="withBase('/editor') + '?documentId=' + encodeURIComponent(id)">このページを編集</a><span v-else>この資料はWeb編集の対象外です。</span></div>
    </template>
    <template #layout-bottom><div class="manual-status"><span>{{ isEditor ? '編集モード' : '閲覧モード' }}</span><span v-if="page.lastUpdated">最終更新 {{ new Date(page.lastUpdated).toISOString().slice(0, 10) }}</span><span>公開版 {{ theme.publicVersion }} · PandD Platform</span></div></template>
  </DefaultTheme.Layout>
</template>
