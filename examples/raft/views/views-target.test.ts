// The Raft elements over a real 3-node cluster on the sim clock: each renders its model, each button calls its op.
import { afterEach, expect, test } from 'bun:test'
import { Registry, type Application } from '@pritzlaff/nano-core'
import { Cluster, RaftNode, advance, must, openRaft, wait, mount, cluster, status } from './views-setup.ts'

let app: Application
afterEach(async () => { document.body.innerHTML = ''; await app?.close() })

test('swapping the target to a second app shows that app, not the first', async () => {
  app = await cluster()
  const first = app, leader = (await Promise.all(['example-1', 'example-2', 'example-3'].map(id => status(app, id)))).find(n => n.role === 'leader')!.id
  must(await first.call(leader, `${leader}-raft`)[RaftNode.ops.request.name]!('hello'))
  await advance(first, 300)
  const el = await mount('raft-node', first, leader, `${leader}-raft`)
  const ledger = await mount('raft-ledger', first, leader, `${leader}-ledger`)
  expect(Number(el.shadowRoot!.querySelector('text')!.textContent)).toBeGreaterThan(0)
  expect(ledger.shadowRoot!.querySelectorAll('tr')).toHaveLength(2)   // the first app's ledger is not empty
  app = await openRaft()   // a second app with a fresh cluster at time 0: every node at term 0, no log
  must(await app.call('raft', 'cluster')[Cluster.ops.create.name]!({ name: 'example', size: 3, seed: 1 }))
  for (const e of [el, ledger]) { e.target = { app, registry: Registry.create(), runtime: leader, pod: e === el ? `${leader}-raft` : `${leader}-ledger` }; await wait(); await e.updateComplete }
  expect(el.shadowRoot!.querySelector('text')!.textContent).toBe('0')
  expect(ledger.shadowRoot!.querySelectorAll('tr')).toHaveLength(1)
  expect(ledger.shadowRoot!.textContent).not.toContain('hello')
  await first.close()
})

test('a read from the old target that resolves after the swap is ignored', async () => {
  app = await cluster()
  const real = await status(app, 'example-1')
  const late: Record<string, (v: unknown) => void> = {}
  const stub = { runtime: () => ({ subscribe: () => () => {}, get: () => ({
    status: () => new Promise(r => { late.status = r }), now: () => new Promise(r => { late.now = r }), read: () => new Promise(r => { late.read = r }) }) }) } as unknown as Application
  const el = await mount('raft-node', stub, 'r', 'p'), ledger = await mount('raft-ledger', stub, 'r', 'p')
  el.target = { app, registry: Registry.create(), runtime: 'example-1', pod: 'example-1-raft' }   // swap while the stub's reads are pending
  ledger.target = { app, registry: Registry.create(), runtime: 'example-1', pod: 'example-1-ledger' }
  await wait(); await el.updateComplete; await ledger.updateComplete
  const shown = () => [el.shadowRoot!.querySelector('text')!.textContent, ledger.shadowRoot!.querySelectorAll('tr').length]
  const before = shown()
  late.status!({ ...real, p: { ...real.p, currentTerm: 99 } }); late.now!(5); late.read!({ currentTerm: 99, votedFor: null, log: [{ index: 1, term: 99, value: 'stale', at: 0 }] })
  await wait(); await el.updateComplete; await ledger.updateComplete
  expect(shown()).toEqual(before)
  expect(el.shadowRoot!.querySelector('text')!.textContent).not.toBe('99')
  expect(ledger.shadowRoot!.textContent).not.toContain('stale')
})

test('after a swap, nothing of the old target shows while the new target has not answered', async () => {
  app = await cluster()
  const el = await mount('raft-node', app, 'example-1', 'example-1-raft'), ledger = await mount('raft-ledger', app, 'example-1', 'example-1-ledger')
  expect(el.shadowRoot!.querySelector('text')).not.toBeNull()
  const never = new Promise(() => {})
  const stub = { runtime: () => ({ subscribe: () => () => {}, get: () => ({ status: () => never, now: () => never, read: () => never }) }) } as unknown as Application
  for (const e of [el, ledger]) { e.target = { app: stub, registry: Registry.create(), runtime: 'r', pod: 'p' }; await wait(); await e.updateComplete }
  expect(el.shadowRoot!.querySelector('text')).toBeNull()
  expect(ledger.shadowRoot!.querySelector('table')).toBeNull()
})

test('a target whose app has no such runtime or pod (a shadow from before the cluster) renders empty, no throw', async () => {
  app = await openRaft()
  const empty = (el: HTMLElement) => expect(el.shadowRoot!.innerHTML.replace(/<!--[^]*?-->/g, '').trim()).toBe('')
  for (const [tag, pod] of [['raft-node', 'example-1-raft'], ['raft-ledger', 'example-1-ledger']] as const) {
    const el = await mount(tag, app, 'example-1', pod)   // no runtime example-1: mount awaits updateComplete, which a throw rejects
    empty(el)
    el.target = { app, registry: Registry.create(), runtime: 'raft', pod }   // the runtime is there, the pod isn't
    await wait(); await el.updateComplete
    empty(el)
  }
})
