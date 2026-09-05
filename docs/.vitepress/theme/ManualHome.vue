<script setup>
import { useData, withBase } from 'vitepress';
const { frontmatter } = useData();
</script>
<template>
  <section class="manual-home" aria-labelledby="manual-title">
    <p class="manual-kicker">// PANDD / TECHNICAL LIBRARY</p>
    <h1 id="manual-title">{{ frontmatter.manual.title }}</h1>
    <p class="manual-description">{{ frontmatter.manual.description }}</p>
    <div class="manual-tab">CONTENTS <span>目次</span></div>
    <ol class="manual-contents">
      <li v-for="(entry, i) in frontmatter.manual.entries" :key="i">
        <span class="manual-number">{{ String(i + 1).padStart(2, '0') }}</span>
        <div><a :href="withBase(entry.link)">{{ entry.title }} <span aria-hidden="true">→</span></a><p>{{ entry.description }}</p></div>
      </li>
    </ol>
    <div class="manual-shortcuts"><span>よく使う資料</span><a :href="withBase('/IMPLEMENTATION_STATUS')">開発状況</a><a :href="withBase('/security')">セキュリティ</a><a :href="withBase('/OPERATIONS')">運用・障害対応</a></div>
  </section>
</template>
