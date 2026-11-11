import { expect, test } from 'bun:test'
import { Ops } from '@pritzlaff/nano-core'
import { Range, Map as MapC, Log } from '@composable/bundle'
import { PlatformOps as P, runtimeOf } from '@composable/platform'
import { checkApp } from '@composable/shell'
import { snapshotApp } from '../src/app/snapshot'
import { appHost, memoryStores, Profile, tick } from './fixtures/app-host'

async function world() {
  const h = appHost(), { call } = h
  await call('platform', P.createComponent, { kind: 'profile', name: 'profile', system: 'host' })
  await call('profile', Profile.ops.setUser, { name: 'Ada' })
  await call('profile', Profile.ops.setEntries, [{ label: 'Home', href: '#/' }])
  await call('platform', P.createComponent, { kind: 'log', name: 'ex-log', system: 'host' })   // a built-in: not written
  await call('platform', P.createSystem, 'lab')
  await call('platform', P.createComponent, { kind: 'range', name: 'r1', system: 'lab', mode: 'host', allow: ['host/log/*'], deny: ['host/platform/*'] })
  const lab = runtimeOf(h.host.registry, 'lab')!
  await lab.call({ registry: 'lab', instance: 'x' }, 'r1', Ops.key(Range.ops.configure), { min: 0, max: 10, step: 0.5, value: 4 })
  await call('platform', P.createComponent, { kind: 'map', name: 'm1', system: 'lab' })
  await lab.call({ registry: 'lab', instance: 'x' }, 'm1', Ops.key(MapC.ops.setCode), 'return x * 2')
  await call('platform', P.createComponent, { kind: 'log', name: 'l1', system: 'lab' })
  await call('platform', P.connect, { system: 'lab', source: 'r1', op: Ops.key(Range.ops.value), listener: 'm1', target: Ops.key(MapC.ops.map) })
  await call('platform', P.createComponent, { kind: 'boxed', name: 'b1', system: 'lab', mode: 'isolated-sandbox' })
  const { stores, st } = memoryStores({ title: 'My app', theme: { theme: 'terminal', mode: 'dark' }, layouts: { '/lab': { root: 1 } } })
  st.imports = [{ url: 'https://x.test/m.json', name: 'p', version: '1', trust: 'sandboxed' }]
  st.workspaces = [{ path: '/lab', title: 'Lab', icon: 'rocket', system: 'lab' }]
  await tick()
  return { ...h, stores }
}

test('snapshot of a host with a user system, a guarded sandboxed instance with config and a wiring', async () => {
  const { host, stores } = await world()
  const app = await snapshotApp({ host, stores })
  expect(typeof checkApp(app)).toBe('object')
  expect(app.title).toBe('My app')
  expect(app.theme).toEqual({ id: 'terminal', mode: 'dark' })
  expect(app.profile).toEqual({ user: { name: 'Ada' }, entries: [{ label: 'Home', href: '#/' }] })
  expect(app.imports).toEqual([{ url: 'https://x.test/m.json', trust: 'sandboxed' }])
  expect(app.systems.map(s => s.id)).toEqual(['lab'])   // the host's built-ins only: not written
  const [lab] = app.systems
  expect(lab!.instances.find(i => i.id === 'r1')).toEqual({ id: 'r1', kind: 'range', mode: 'host', allow: ['host/log/*'], deny: ['host/platform/*'], config: { min: 0, max: 10, step: 0.5, value: 4 } })
  expect(lab!.instances.find(i => i.id === 'm1')).toMatchObject({ kind: 'map', config: { code: 'return x * 2' } })
  expect(lab!.instances.find(i => i.id === 'b1')).toMatchObject({ kind: 'boxed', mode: 'isolated-sandbox' })   // its frame never answers: no config
  expect(lab!.subscriptions).toEqual([{ source: 'r1', op: Ops.key(Range.ops.value), listener: 'm1', target: Ops.key(MapC.ops.map) }])
  expect(app.workspaces).toEqual([{ id: '/lab', title: 'Lab', system: 'lab', icon: 'rocket', layout: { root: 1 } }])
}, 10_000)

test('reserved ids, view-owned listeners and the Main workspace are never written', async () => {
  const { host, stores, call } = await world()
  host.registry.add('~view-1', (await import('@pritzlaff/nano-core')).Components.instantiate(Log), { kind: 'view', name: 'v' })
  const lab = (await call('platform', P.systems)).value.find((s: any) => s.id === 'lab')
  expect(lab).toBeDefined()
  await call('platform', P.createComponent, { kind: 'log', name: 'ex-mine', system: 'lab' })
  ;(stores.workspaces as any).set([{ path: '/workspace', title: 'Main', icon: 'box' }])
  const app = await snapshotApp({ host, stores })
  expect(app.systems.flatMap(s => s.instances).map(i => i.id)).not.toContain('ex-mine')
  expect(app.systems.flatMap(s => s.instances).map(i => i.id)).not.toContain('~view-1')
  expect(app.workspaces).toEqual([])
})
