// The page store: the run-time truth for pages. Main (`workspace`) first and kept; fixed routes and unplaced pods refused.
import { expect, test } from 'bun:test'
import type { Page } from '@pritzlaff/nano-ui'
import { pageStore } from '../src/lib/pages.ts'

const main: Page = { id: 'workspace', title: 'Workspace', slots: [] }
const trading: Page = { id: 'trading', title: 'Trading', icon: 'chart', slots: [{ id: 'a', runtime: 'main', pod: 'clock1' }, { id: 'n', view: 'nano-explorer' }] }
const placedPods = new Set(['main/clock1'])
const placed = (r: string, p: string) => placedPods.has(`${r}/${p}`)
const refused = (r: { ok: boolean }) => expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })

test('Main is there and first, even when not given', () => {
  expect(pageStore([], placed).list()).toEqual([main])
  expect(pageStore([trading, { ...main, title: 'Home' }], placed).list().map(p => p.id)).toEqual(['workspace', 'trading'])
})

test('set adds or replaces by id; a rename keeps the id; index moves it', () => {
  const s = pageStore([main], placed), heard: number[] = []
  s.subscribe(() => heard.push(1))
  expect(s.set(trading)).toEqual({ ok: true, value: undefined })
  expect(s.set({ id: 'notes', title: 'Notes', slots: [] })).toMatchObject({ ok: true })
  expect(s.set({ ...trading, title: 'Markets' })).toMatchObject({ ok: true })
  expect(s.get('trading')?.title).toBe('Markets')
  expect(s.list().map(p => p.id)).toEqual(['workspace', 'trading', 'notes'])
  expect(s.set(s.get('notes')!, 1)).toMatchObject({ ok: true })
  expect(s.list().map(p => p.id)).toEqual(['workspace', 'notes', 'trading'])
  expect(heard.length).toBe(4)
})

test('set refuses fixed routes, unplaced pods, bad ids, and moving Main from first', () => {
  const s = pageStore([main, trading], placed)
  for (const id of ['ring', 'desk', 'settings', 'systems', 'messages', 'components', 'themes', 'inbox']) refused(s.set({ id, title: id, slots: [] }))
  refused(s.set({ ...trading, slots: [{ id: 'b', runtime: 'main', pod: 'gone' }] }))
  refused(s.set({ ...trading, slots: [{ id: 'b', runtime: 'other', pod: 'clock1' }] }))
  refused(s.set({ id: 'a/b', title: 'x', slots: [] }))
  refused(s.set(main, 1))
  refused(s.set(trading, 0))
  expect(s.set({ ...main, title: 'Home', icon: 'home' }, 0)).toMatchObject({ ok: true })   // its title and icon change
  expect(s.list().map(p => [p.id, p.title])).toEqual([['workspace', 'Home'], ['trading', 'Trading']])
})

test('remove drops a page; Main and fixed routes are refused, an unknown id is not-found', () => {
  const s = pageStore([main, trading], placed)
  refused(s.remove('workspace'))
  refused(s.remove('ring'))
  expect(s.remove('nope')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  expect(s.remove('trading')).toEqual({ ok: true, value: undefined })
  expect(s.list()).toEqual([main])
})

test('list and get are copies', () => {
  const s = pageStore([main, trading], placed)
  s.list()[1]!.title = 'X'; s.get('trading')!.slots.length = 0
  expect(s.get('trading')).toEqual(trading)
})

test('prune drops pod slots no longer placed, from every page, and says whether it changed anything', () => {
  const geometry = { a: { x: 0, y: 0, w: 1, h: 1 } }
  const s = pageStore([{ ...main, slots: [trading.slots[0]!], geometry }, trading], placed), heard: number[] = []
  s.subscribe(() => heard.push(1))
  expect(s.prune(placed)).toBe(false)
  expect(heard).toEqual([])
  expect(s.prune(() => false)).toBe(true)   // clock1 undeployed: it was shown on two pages
  expect(s.get('workspace')).toEqual(main)
  expect(s.get('trading')!.slots).toEqual([{ id: 'n', view: 'nano-explorer' }])
  expect(heard).toEqual([1])
})

test('subscribe returns its unsubscribe', () => {
  const s = pageStore([], placed), heard: number[] = [], off = s.subscribe(() => heard.push(1))
  off()
  s.set(trading)
  expect(heard).toEqual([])
})
