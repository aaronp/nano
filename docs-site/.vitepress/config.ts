import { defineConfig } from 'vitepress'
import { readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'

// Dev only: the playground frame imports the host's built shared modules from `<base>../shared/`.
const shared = join(__dirname, '../../packages/ui-workspace/public/shared')
const serveShared = {
  name: 'nano-shared',
  configureServer: (server: { middlewares: { use: (p: string, h: (req: { url?: string }, res: any, next: () => void) => void) => void } }) => {
    server.middlewares.use('/shared', async (req, res, next) => {
      try {
        const file = normalize(join(shared, (req.url ?? '').split('?')[0]))
        if (!file.startsWith(shared)) throw new Error('outside')
        const body = await readFile(file)
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Content-Type', 'text/javascript')
        res.end(body)
      } catch { res.statusCode = 404; res.end('Not found') }
    })
  },
}

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
  vite: { plugins: [serveShared] },
  outDir: '../packages/ui-workspace/public/docs',
  themeConfig: {
    search: { provider: 'local' },
    sidebar: [
      { text: 'Learn', items: learn.map(([page, text]) => ({ text, link: `/learn/${page}` })) },
      { text: 'Recipes', items: recipes.map(r => ({ text: title(r), link: `/recipes/${r}` })) },
    ],
  },
})
