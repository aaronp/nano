import { snapshotApp } from '@pritzlaff/nano-app'
import { expect, test } from 'bun:test'
import { Components, Ops } from '@pritzlaff/nano-core'
import { Range, Map as MapC, Log } from '@composable/bundle'
import { PlatformOps as P, runtimeOf } from '@composable/platform'
import { checkApp } from '@composable/shell'
import { appHost, memoryStores, Profile, tick } from './fixtures/app-host'

async function world() {
  const h = appHost(), { call } = h
  await call('application', P.createComponent, { kind: 'profile', name: 'profile', system: 'host' })
  await call('profile', Profile.ops.setUser, { name: 'Ada' })
  await call('profile', Profile.ops.setEntries, [{ label: 'Home', href: '#/' }])
  await call('application', P.createComponent, { kind: 'log', name: 'ex-log', system: 'host' })   // a built-in: not written
  await call('application', P.createSystem, 'lab')
  await call('application', P.createComponent, { kind: 'range', name: 'r1', system: 'lab', mode: 'host', allow: ['host/log/*'], deny: ['host/application/*'] })
  const lab = runtimeOf(h.host.registry, 'lab')!
  await lab.call({ registry: 'lab', instance: 'x' }, 'r1', Ops.key(Range.ops.configure), { min: 0, max: 10, step: 0.5, value: 4 })
  await call('application', P.createComponent, { kind: 'map', name: 'm1', system: 'lab' })
  await lab.call({ registry: 'lab', instance: 'x' }, 'm1', Ops.key(MapC.ops.setCode), 'return x * 2')
  await call('application', P.createComponent, { kind: 'log', name: 'l1', system: 'lab' })
  await call('application', P.connect, { system: 'lab', source: 'r1', op: Ops.key(Range.ops.value), listener: 'm1', target: Ops.key(MapC.ops.map) })
  await call('application', P.createComponent, { kind: 'boxed', name: 'b1', system: 'lab', mode: 'isolated-sandbox' })
  const { stores, st } = memoryStores({ title: 'My app', theme: { theme: 'terminal', mode: 'dark' } })
  st.imports = [{ url: 'https://x.test/m.json', name: 'p', version: '1', trust: 'sandboxed' }]
  await call('application', P.setScreen, { id: '/workspace', title: 'Main', system: 'host', layout: { root: 2 } })   // Main: a screen, never written
  await call('application', P.setScreen, { id: '/lab', title: 'Lab', icon: 'rocket', system: 'lab', layout: { root: 1 } })
  await tick()
  return { ...h, stores }
}

test('snapshot of a host with a user system, a guarded sandboxed instance with config and a wiring', async () => {
  const { host, stores } = await world()
  const app = await snapshotApp(host, stores)
  expect(typeof checkApp(app)).toBe('object')
  expect(app.title).toBe('My app')
  expect(app.theme).toEqual({ id: 'terminal', mode: 'dark' })
  expect(app.profile).toEqual({ user: { name: 'Ada' }, entries: [{ label: 'Home', href: '#/' }] })
  expect(app.imports).toEqual([{ url: 'https://x.test/m.json', trust: 'sandboxed' }])
  expect(app.systems.map(s => s.id)).toEqual(['lab'])   // the host's built-ins only: not written
  const [lab] = app.systems
  expect(lab!.instances.find(i => i.id === 'r1')).toEqual({ id: 'r1', kind: 'range', mode: 'host', allow: ['host/log/*'], deny: ['host/application/*'], config: { min: 0, max: 10, step: 0.5, value: 4 } })
  expect(lab!.instances.find(i => i.id === 'm1')).toMatchObject({ kind: 'map', config: { code: 'return x * 2' } })
  expect(lab!.instances.find(i => i.id === 'b1')).toMatchObject({ kind: 'boxed', mode: 'isolated-sandbox' })   // its frame never answers: no config
  expect(lab!.subscriptions).toEqual([{ source: 'r1', op: Ops.key(Range.ops.value), listener: 'm1', target: Ops.key(MapC.ops.map) }])
  expect(app.workspaces).toEqual([{ id: '/workspace', title: 'Main', system: 'host', layout: { root: 2 } }, { id: '/lab', title: 'Lab', system: 'lab', icon: 'rocket', layout: { root: 1 } }])
}, 10_000)

test('reserved ids, view-owned listeners are never written', async () => {
  const { host, stores, call } = await world()
  host.registry.add('~view-1', (await import('@pritzlaff/nano-core')).Components.instantiate(Log), { kind: 'view', name: 'v' })
  const lab = (await call('application', P.systems)).value.find((s: any) => s.id === 'lab')
  expect(lab).toBeDefined()
  await call('application', P.createComponent, { kind: 'log', name: 'ex-mine', system: 'lab' })
  await call('application', P.removeScreen, '/lab')   // only Main is left
  const app = await snapshotApp(host, stores)
  expect(app.systems.flatMap(s => s.instances).map(i => i.id)).not.toContain('ex-mine')
  expect(app.systems.flatMap(s => s.instances).map(i => i.id)).not.toContain('~view-1')
  expect(app.workspaces.map(w => w.id)).toEqual(['/workspace'])
})

test('the gateway is never written, in host or a workspace system', async () => {
  const { host, stores } = await world()
  expect(runtimeOf(host.registry, 'lab')!.registry.get('app')).toBeDefined()
  const app = await snapshotApp(host, stores)
  expect(app.systems.flatMap(s => s.instances).map(i => i.id)).not.toContain('app')
})

test('wires into the app gateway or a dock\'s controls are never written (Main is, as a workspace)', async () => {
  const { host, stores } = await world()
  const lab = runtimeOf(host.registry, 'lab')!
  lab.registry.add('ws-controls-x', Components.instantiate(Log), { kind: 'app', name: 'test' })   // a stand-in for the controls
  for (const [listener, target] of [['app', 'nano.shell/app-gateway/setAppBarComponent'], ['ws-controls-x', Ops.key(Log.ops.info)]]) {
    expect('error' in lab.registry.subscribe({ source: 'r1', op: Ops.key(Range.ops.value), listener: listener!, target: target! })).toBe(false)
  }
  const app = await snapshotApp(host, stores)
  expect(app.systems.find(s => s.id === 'lab')!.subscriptions.map(s => s.listener)).toEqual(['m1'])
})
