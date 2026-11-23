import { defineConfig } from 'vitepress'

const concepts = ['interfaces', 'implementations', 'pods', 'wiring', 'headless', 'views', 'host', 'isolation', 'packaging']
const recipes = ['timer', 'pipeline', 'host-pods', 'deploying-pods']
const title = (s: string) => s.replace(/(^|-)(\w)/g, (_, d, c) => (d ? ' ' : '') + c.toUpperCase())

export default defineConfig({
  title: 'nano',
  base: process.env.DOCS_BASE ?? '/docs/',
  outDir: '../packages/ui-workspace/public/docs',
  themeConfig: {
    search: { provider: 'local' },
    sidebar: [
      { text: 'Concepts', items: [{ text: 'At a glance', link: '/' }, ...concepts.map(c => ({ text: title(c), link: `/concepts/${c}` }))] },
      { text: 'Recipes', items: recipes.map(r => ({ text: title(r), link: `/recipes/${r}` })) },
    ],
  },
})
