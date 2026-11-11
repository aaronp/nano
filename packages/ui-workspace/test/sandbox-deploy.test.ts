import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes } from '@pritzlaff/nano-core'
import { catalog as bundle, Range } from '@composable/bundle'
import { deploy, deployStrategy, type AppCatalog } from '../src/sandbox/deploy'
import type { Frame } from '../src/sandbox/stand-in'

const cat: AppCatalog = {
  range: { ...bundle.range!, modes: ['host'], trust: 'trusted' },
  pkg: { ...bundle.range!, modes: ['host', 'sandbox', 'isolated-sandbox'], trust: 'trusted', source: { url: 'https://x.test/p.js' } },
  boxed: { ...bundle.range!, modes: ['isolated-sandbox'], trust: 'sandboxed', source: { url: 'https://x.test/p.js' } },
}
const tick = () => new Promise(r => setTimeout(r, 0))
const fake = () => {
  const ch = new MessageChannel(), opened: unknown[] = []
  const open = (o: unknown) => { opened.push(o); return { port: ch.port1, ready: new Promise<void>(() => {}), dispose() {} } as Frame }
  return { ch, opened, open: open as never }
}
const keys = (c: { actions: Map<string, unknown> }) => [...c.actions.keys()].sort()

test('host returns the kind\'s component unchanged', () => {
  expect(deployStrategy(cat)('pkg', 'host')).toBe(cat.pkg!.component)
})

test('iframe modes return a stand-in with the same id and op keys', () => {
  const { open, opened } = fake()
  const c = deployStrategy(cat, open)('pkg', 'sandbox')
  expect(c).not.toBe(cat.pkg!.component)
  expect(c.id).toEqual(cat.pkg!.component.id)
  expect(keys(c)).toEqual(keys(cat.pkg!.component))
  Components.instantiate(c)   // opens a frame, with the mode and the package url
  expect(opened).toEqual([expect.objectContaining({ url: 'https://x.test/p.js', kind: 'pkg', mode: 'sandbox' })])
})

test('a mode the kind doesn\'t allow throws; built-ins allow only host', () => {
  const s = deployStrategy(cat, fake().open)
  expect(() => s('range', 'sandbox')).toThrow(/range can't be deployed as sandbox/)
  expect(() => s('boxed', 'host')).toThrow(/boxed can't be deployed as host/)
  expect(() => s('nope', 'host')).toThrow(/nope/)
})

test('deploy labels nano/deploy and nano/trust, guards iframe modes (nano/guarded) and the label survives the guard', () => {
  const rt = Runtimes.create(Registries.create('host')), { open } = fake()
  expect(deploy(rt, 'a', 'range', 'host', { catalog: cat })).toEqual({ value: undefined })
  expect(rt.registry.labels('a')).toEqual({ 'nano/deploy': 'host', 'nano/trust': 'trusted' })
  expect('value' in deploy(rt, 'b', 'pkg', 'sandbox', { catalog: cat, open })).toBe(true)
  expect(rt.registry.labels('b')).toEqual({ 'nano/deploy': 'sandbox', 'nano/trust': 'trusted', 'nano/guarded': 'true' })
  deploy(rt, 'c', 'boxed', 'isolated-sandbox', { catalog: cat, open })
  expect(rt.registry.labels('c')).toMatchObject({ 'nano/trust': 'sandboxed', 'nano/guarded': 'true' })
  deploy(rt, 'd', 'range', 'host', { catalog: cat, outward: { deny: ['*'] } })
  expect(rt.registry.labels('d')['nano/guarded']).toBe('true')
  expect('error' in deploy(rt, 'e', 'range', 'sandbox', { catalog: cat, open })).toBe(true)
  expect(rt.registry.get('e')).toBeUndefined()
})

test('with no selectors an isolated instance\'s outcall is refused; allowed ones go through', async () => {
  const rt = Runtimes.create(Registries.create('host')), { open, ch } = fake()
  rt.registry.add('other', Components.instantiate(bundle.range!.component))
  deploy(rt, 'x', 'boxed', 'isolated-sandbox', { catalog: cat, open })
  const replies: any[] = []
  ch.port2.onmessage = e => replies.push(e.data)
  const key = Ops.key(Range.ops.value)
  ch.port2.postMessage({ type: 'outcall', id: 1, target: 'other', op: key, arg: null }); await tick(); await tick()
  expect(replies[0]).toMatchObject({ type: 'outresult', id: 1, result: { error: expect.stringContaining('may not call') } })

  const rt2 = Runtimes.create(Registries.create('host')), f2 = fake()
  rt2.registry.add('other', Components.instantiate(bundle.range!.component))
  deploy(rt2, 'x', 'boxed', 'isolated-sandbox', { catalog: cat, open: f2.open, outward: { allow: ['host/other/*'] } })
  const r2: any[] = []
  f2.ch.port2.onmessage = e => r2.push(e.data)
  f2.ch.port2.postMessage({ type: 'outcall', id: 2, target: 'other', op: key, arg: null }); await tick(); await tick()
  expect(r2[0].result.error ?? '').not.toContain('may not call')
})

test('a deny-only selector set is still deny-all plus the deny', async () => {
  const rt = Runtimes.create(Registries.create('host')), { open, ch } = fake()
  rt.registry.add('other', Components.instantiate(bundle.range!.component))
  deploy(rt, 'x', 'boxed', 'isolated-sandbox', { catalog: cat, open, outward: { deny: ['host/nothing/*'] } })
  const replies: any[] = []
  ch.port2.onmessage = e => replies.push(e.data)
  ch.port2.postMessage({ type: 'outcall', id: 1, target: 'other', op: Ops.key(Range.ops.value), arg: null }); await tick(); await tick()
  expect(replies[0].result.error).toContain('may not call')
})

test('deploying to a taken id is an error and opens no frame', () => {
  const rt = Runtimes.create(Registries.create('host')), f = fake()
  rt.registry.add('a', Components.instantiate(bundle.range!.component))
  expect('error' in deploy(rt, 'a', 'pkg', 'sandbox', { catalog: cat, open: f.open })).toBe(true)
  expect(f.opened).toEqual([])
})

test('nano/trust comes from the entry, not its modes', () => {
  const rt = Runtimes.create(Registries.create('host')), { open } = fake()
  deploy(rt, 'a', 'pkg2', 'isolated-sandbox', { catalog: { ...cat, pkg2: { ...cat.pkg!, modes: ['isolated-sandbox'] } }, open })
  expect(rt.registry.labels('a')['nano/trust']).toBe('trusted')
})

test('removing a deployed isolated instance disposes its frame', async () => {
  const rt = Runtimes.create(Registries.create('host')), ch = new MessageChannel()
  let disposed = 0
  const open = (() => ({ port: ch.port1, ready: new Promise<void>(() => {}), dispose() { disposed++ } }) as Frame) as never
  deploy(rt, 'b', 'boxed', 'isolated-sandbox', { catalog: cat, open })
  rt.registry.remove('b'); await tick()
  expect(disposed).toBe(1)
})
