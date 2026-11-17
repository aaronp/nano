// The Application's screens, kept in this browser in the saved-workspaces format from before the Application held them.
import { expect, test } from 'bun:test'
import { ApplicationOps as P, applyApp } from '@pritzlaff/nano-app'
import { persistScreens } from '../src/lib/screens.ts'
import { KEY } from '../src/lib/saved-workspaces.ts'
import { known } from '../src/app/known'
import { appHost, memoryStores, tick } from './fixtures/app-host'

const memory = () => { const m = new Map<string, string>(); return Object.assign(m, { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }) as unknown as Storage & Map<string, string> }
const layout = (instance: string) => ({ root: { type: 'stack', content: [{ type: 'component', id: 'p1', componentState: { widget: 'w', name: instance } }] } })

/** Today's format: the saved list (no Main), a saved workspace's layout, and Main's layout under the main dock's key. */
const seeded = () => {
  const s = memory()
  s.setItem(KEY, JSON.stringify([{ path: '/b', title: 'B', icon: 'box', system: 'host' }, { path: '/a', title: 'A', icon: 'star', system: 'lab' }]))
  s.setItem('k.saved./a', JSON.stringify(layout('r1')))
  s.setItem('k', JSON.stringify(layout('ex-log')))
  return s
}

test('screens from before this change still load', async () => {
  const h = appHost(), s = seeded()
  await persistScreens(h.host, s, '/workspace', 'k')
  const screens = (await h.call('application', P.screens)).value
  expect(screens).toEqual([
    { id: '/workspace', title: 'Main', system: 'host', layout: layout('ex-log') },
    { id: '/b', title: 'B', icon: 'box', system: 'host', layout: null },
    { id: '/a', title: 'A', icon: 'star', system: 'lab', layout: layout('r1') },   // its system is made first
  ])
  expect((await h.call('application', P.placements, { screen: '/a' })).value).toEqual([{ screen: '/a', panel: 'p1', instance: 'r1', box: { x: 0, y: 0, w: 1, h: 1 }, tab: { group: '0', active: true } }])
})

test('a change to a screen is written back in the old format', async () => {
  const h = appHost(), s = seeded()
  await persistScreens(h.host, s, '/workspace', 'k')
  await h.call('application', P.setScreen, { id: '/c', title: 'C', icon: 'flag', system: 'host', layout: layout('m1') })
  await h.call('application', P.moveScreen, { id: '/a', by: 1 })
  await tick()
  expect(JSON.parse(s.getItem(KEY)!)).toEqual([{ path: '/b', title: 'B', icon: 'box', system: 'host' }, { path: '/c', title: 'C', icon: 'flag', system: 'host' }, { path: '/a', title: 'A', icon: 'star', system: 'lab' }])
  expect(JSON.parse(s.getItem('k.saved./c')!)).toEqual(layout('m1'))
  expect(JSON.parse(s.getItem('k.saved./a')!)).toEqual(layout('r1'))
})

test('the main workspace is a screen but never in the saved list', async () => {
  const h = appHost(), s = seeded()
  const stop = await persistScreens(h.host, s, '/workspace', 'k')
  await h.call('application', P.setScreen, { id: '/workspace', title: 'Main', system: 'host', layout: layout('other') })
  await tick()
  expect(JSON.parse(s.getItem(KEY)!).map((w: { path: string }) => w.path)).toEqual(['/b', '/a'])
  expect(JSON.parse(s.getItem('k')!)).toEqual(layout('other'))   // under its dock's own key, read when the dock mounts
  expect(s.has('k.saved./workspace')).toBe(false)
  stop()
  await h.call('application', P.removeScreen, '/b'); await tick()
  expect(JSON.parse(s.getItem(KEY)!).map((w: { path: string }) => w.path)).toEqual(['/b', '/a'])   // stopped: no more writes
})

test('a change is in storage as soon as the call returns, before any dock mounts', async () => {
  const h = appHost(), s = seeded()
  await persistScreens(h.host, s, '/workspace', 'k')
  await h.call('application', P.setScreen, { id: '/c', title: 'C', icon: 'flag', system: 'host', layout: layout('m1') })
  expect(JSON.parse(s.getItem('k.saved./c')!)).toEqual(layout('m1'))
  expect(JSON.parse(s.getItem(KEY)!).map((w: { path: string }) => w.path)).toEqual(['/b', '/a', '/c'])
})

test("a document's main-workspace layout reaches the main dock's key", async () => {
  const h = appHost(), s = seeded()
  await persistScreens(h.host, s, '/workspace', 'k')
  const deps = { host: h.host, stores: memoryStores().stores, catalog: h.catalog, known, importPackage: async () => ({}) }
  expect(await applyApp({ nano: 1, title: 'Doc', imports: [], systems: [], workspaces: [{ id: '/workspace', title: 'Main', system: 'host', layout: layout('doc') }] }, 'replace', deps)).toEqual([])
  await tick()
  expect(JSON.parse(s.getItem('k')!)).toEqual(layout('doc'))
  expect(JSON.parse(s.getItem(KEY)!)).toEqual([])
})

test('a stored workspace with a blank title still loads, titled by its path', async () => {
  const h = appHost(), s = seeded()
  s.setItem(KEY, JSON.stringify([{ path: '/b', title: '  ', icon: 'box', system: 'host' }, { path: '/a', title: 'A', icon: 'star', system: 'lab' }]))
  await persistScreens(h.host, s, '/workspace', 'k')
  expect((await h.call('application', P.screens)).value.map((x: { id: string; title: string }) => [x.id, x.title])).toEqual([['/workspace', 'Main'], ['/b', '/b'], ['/a', 'A']])
  await h.call('application', P.moveScreen, { id: '/a', by: -1 })
  expect(JSON.parse(s.getItem(KEY)!).map((w: { path: string }) => w.path)).toEqual(['/a', '/b'])   // not dropped on the next write
})
