import { defineConfig } from 'vitepress'

const recipes = ['pipeline', 'host-pods', 'deploying-pods']
const title = (s: string) => (s[0].toUpperCase() + s.slice(1)).replace(/-/g, ' ')

export default defineConfig({
  title: 'nano',
  base: process.env.DOCS_BASE ?? '/docs/',
  outDir: '../packages/ui-workspace/public/docs',
  themeConfig: {
    search: { provider: 'local' },
    sidebar: [
      { text: 'Learn', items: [] },
      { text: 'Recipes', items: recipes.map(r => ({ text: title(r), link: `/recipes/${r}` })) },
    ],
  },
})
