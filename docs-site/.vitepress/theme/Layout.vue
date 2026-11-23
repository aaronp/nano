<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import Playground from './Playground.vue'
const { frontmatter } = useData()
</script>

<template>
  <div :class="{ 'pg-on': frontmatter.playground }">
    <DefaultTheme.Layout>
      <template #doc-after><Playground v-if="frontmatter.playground" :key="frontmatter.playground" :step="frontmatter.playground" /></template>
    </DefaultTheme.Layout>
  </div>
</template>
