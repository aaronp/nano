import { defineConfig } from 'vitepress'

const learn = [['01-plain', 'Plain TypeScript'], ['02-contract', 'The contract'], ['03-builder', 'The builder'], ['04-registry', 'The Registry'], ['05-runtime', 'A Runtime']]
const recipes = ['pipeline', 'host-pods', 'deploying-pods']
const title = (s: string) => (s[0].toUpperCase() + s.slice(1)).replace(/-/g, ' ')

export default defineConfig({
  title: 'nano',
  base: process.env.DOCS_BASE ?? '/docs/',
  outDir: '../packages/ui-workspace/public/docs',
  themeConfig: {
    search: { provider: 'local' },
    sidebar: [
      { text: 'Learn', items: learn.map(([page, text]) => ({ text, link: `/learn/${page}` })) },
      { text: 'Recipes', items: recipes.map(r => ({ text: title(r), link: `/recipes/${r}` })) },
    ],
  },
})
