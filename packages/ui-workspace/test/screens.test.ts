// The Application's screens, kept in this browser in the saved-workspaces format from before the Application held them.
import { expect, test } from 'bun:test'
import { PlatformOps as P } from '@composable/platform'
import { persistScreens } from '../src/lib/screens.ts'
import { KEY } from '../src/lib/saved-workspaces.ts'
import { appHost, tick } from './fixtures/app-host'

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
  expect((await h.call('application', P.placements, { screen: '/a' })).value).toEqual([{ screen: '/a', panel: 'p1', instance: 'r1' }])
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
  expect(JSON.parse(s.getItem('k')!)).toEqual(layout('ex-log'))   // its dock writes its own key
  expect(s.has('k.saved./workspace')).toBe(false)
  stop()
  await h.call('application', P.removeScreen, '/b'); await tick()
  expect(JSON.parse(s.getItem(KEY)!).map((w: { path: string }) => w.path)).toEqual(['/b', '/a'])   // stopped: no more writes
})
