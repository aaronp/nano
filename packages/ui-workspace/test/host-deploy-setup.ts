// Shared setup of the host-deploy tests: registers happy-dom, serves /bundle/nano-ui.js, and the base deployments.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { expect } from 'bun:test'
import { plugin } from 'bun'
import { Pod, type AppDeployment } from '@pritzlaff/nano-core'

export const page = new URL('../../../', import.meta.url).href
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: page })
await import('../src/boot-theme.ts')
const { log } = await import('@pritzlaff/nano-ui')
// /bundle/nano-ui.js is packages/ui, as the site serves it.
export const nanoUi = new URL('../../ui/src/index.ts', import.meta.url).pathname
plugin({ name: 'served', setup(b) {
  b.onResolve({ filter: /bundle\/nano-ui\.js$/ }, () => ({ path: 'nano-ui', namespace: 'served' }))
  b.onLoad({ filter: /.*/, namespace: 'served' }, () => ({ contents: `export * from '${nanoUi}'; export { default } from '${nanoUi}'`, loader: 'ts' }))
} })
export const domFetch = globalThis.fetch
export const installFetch = () => { globalThis.fetch = (async (u: string) => { const f = Bun.file(new URL(u)), ok = await f.exists(); return { ok, status: ok ? 200 : 404, json: () => f.json() } }) as never }
export const restoreFetch = () => { globalThis.fetch = domFetch }

export const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
export const lazy = Pod.lazy(log)
export const node = (i: number) => ({ pods: ['messaging', `example-${i}-raft`], subscriptions: [] })
/** A base with the shared `messaging` and runtime example-2 already there. */
export const base = (): AppDeployment => ({
  pods: { messaging: lazy, 'example-2-raft': lazy }, runtimes: { raft: { pods: ['messaging'], subscriptions: [] }, 'example-2': node(2) },
})
export const three = {
  pods: Object.fromEntries([1, 2, 3].map(i => [`example-${i}-raft`, lazy])),
  runtimes: Object.fromEntries([1, 2, 3].map(i => [`example-${i}`, node(i)])),
}
export async function answer(label: 'Approve' | 'Deny', text = 'Create runtime node-1 (1 pod)') {
  for (let i = 0; i < 100 && !document.querySelector('dialog'); i++) await tick(5)
  const dialog = document.querySelector('dialog')!
  for (const clause of text.split('; ')) expect(dialog.textContent).toContain(clause)   // the dialog lists the summary's clauses
  ;[...dialog.querySelectorAll('button')].find(b => b.textContent === label)!.click()
}
