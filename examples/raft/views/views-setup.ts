// Shared setup of the Raft view tests: registers happy-dom, loads the elements, mounts one and opens a 3-node cluster.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { Registry, type Application } from '@pritzlaff/nano-core'
import type { Node } from '../core/types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
// after the DOM is registered, so lit takes its browser build
export const { ClockControl } = await import('@pritzlaff/nano-ui')
export const { Cluster, Ledger, RaftNode } = await import('../interfaces.ts')
export const { advance, must, openRaft, settle } = await import('../test-host.ts')
export const { glyphModel, gridModel, ledgerModel } = await import('./model.ts')
await import('../index.ts')
export const wait = async () => { for (let i = 0; i < 5; i++) await settle() }
export const mount = async <E extends HTMLElement>(tag: string, app: Application, runtime: string, pod: string) => {
  const el = document.createElement(tag) as E & { target?: unknown; updateComplete: Promise<boolean> }
  el.target = { app, registry: Registry.create(), runtime, pod }
  document.body.append(el); await wait(); await el.updateComplete
  return el
}
export async function cluster() {
  const app = await openRaft()
  must(await app.call('raft', 'cluster')[Cluster.ops.create.name]!({ name: 'example', size: 3, seed: 1 }))
  await advance(app, 1000)
  return app
}
export const status = async (app: Application, id: string) => must(await app.call(id, `${id}-raft`)[RaftNode.ops.status.name]!(null)) as Node
