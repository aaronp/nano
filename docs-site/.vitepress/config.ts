import { defineConfig } from 'vitepress'

const learn = [['01-plain', 'Plain TypeScript'], ['02-contract', 'The contract'], ['03-builder', 'The builder'], ['04-registry', 'The Registry'], ['05-runtime', 'A Runtime'],
  ['06-results', 'Results'], ['07-events', 'Events'], ['08-history', 'A history, by message'], ['09-pipe', 'A pipe'],
  ['10-context', 'NanoContext'], ['11-pods', 'Pods'], ['12-isolation', 'Isolation'], ['13-policies', 'Policies'], ['14-application', 'The Application'],
  ['15-gateway', 'An app gateway'],
  ['16-view', 'A view'], ['17-host', 'In the host'], ['18-packaging', 'Packaging']]
const recipes = ['pipeline', 'host-pods', 'deploying-pods', 'listening-view']
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
