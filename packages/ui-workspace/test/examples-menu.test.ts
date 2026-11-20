// File › Examples › Raft: listed, and importing examples/raft/nano.json (the menu's path: host.importUrl) places cluster, messaging and clock in runtime raft, cluster auto-connected to deploy.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
const page = new URL('../../../', import.meta.url).href
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: page })
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { plugin } from 'bun'

const { EXAMPLES } = await import('../src/components/file-menu.ts')
const { start } = await import('../src/host.ts')

// The served site maps the built example's ./index.js; here it is the example's source (one module).
const index = new URL('../../../examples/raft/index.ts', import.meta.url).pathname
plugin({ name: 'served-raft', setup(b) {
  b.onResolve({ filter: /examples\/raft\/index\.js$/ }, () => ({ path: 'raft', namespace: 'served-raft' }))
  b.onLoad({ filter: /.*/, namespace: 'served-raft' }, () => ({ contents: `export * from '${index}'; export { default } from '${index}'`, loader: 'ts' }))
} })
const { opened } = await import('../src/migrate.ts')
// happy-dom's fetch refuses file: URLs
const domFetch = globalThis.fetch
beforeAll(() => { globalThis.fetch = (async (u: string) => { const f = Bun.file(new URL(u)), ok = await f.exists(); return { ok, status: ok ? 200 : 404, json: () => f.json() } }) as never })
afterAll(() => { globalThis.fetch = domFetch })

test('File › Examples lists Raft, and importing its nano.json places cluster, messaging and clock in runtime raft, cluster auto-connected to deploy', async () => {
  expect(EXAMPLES.map(([n]) => n)).toContain('raft')
  const r = await start()
  if (!r.ok) throw new Error(r.fail.reason)
  const host = r.value
  expect(await host.importUrl(new URL('../../../examples/raft/nano.json', import.meta.url).href)).toMatchObject({ ok: true })
  const d = host.data()
  expect(d.runtimes['raft']!.pods).toEqual(['cluster', 'raft-messaging', 'raft-clock', 'raft-random'])
  expect(d.runtimes['main']!.subscriptions).toContainEqual({ kind: 'call', from: 'cluster', to: 'deploy' })
  const layout = d.layout as unknown as { slots?: unknown; ring: { show: string[] } }
  expect(layout.slots).toBeUndefined()   // its pages are the Outline's (migrate.ts), not the app's layout
  const file = opened(await Bun.file(new URL('../../../examples/raft/nano.json', import.meta.url)).json())
  expect(file.ok && Object.keys(file.value.pages.pages['workspace']!.slots)).toContain('cluster')
  expect(layout.ring.show).toEqual(['example.raft/node', 'example.raft/messaging'])
})
