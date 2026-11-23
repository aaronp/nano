<script setup lang="ts">
import { useData } from 'vitepress'
import { appUrl } from './app-url'
defineProps<{ src: string }>()
const { site } = useData()
</script>

<template>
  <a class="open-in-nano" :href="appUrl(site.base, src)" target="_blank" rel="noopener">Open in nano</a>
</template>
