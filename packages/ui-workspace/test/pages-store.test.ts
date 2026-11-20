// The page store: the run-time truth for pages. Main (`workspace`) first and kept; fixed routes and unplaced pods refused.
import { expect, spyOn, test } from 'bun:test'
import type { Page } from '@pritzlaff/nano-ui'
import { pageStore, slugPath } from '../src/lib/pages.ts'

const main: Page = { id: 'workspace', title: 'Workspace', slots: [] }
const trading: Page = { id: 'trading', title: 'Trading', icon: 'chart', slots: [{ id: 'a', runtime: 'main', pod: 'clock1' }, { id: 'n', view: 'nano-explorer' }] }
const placedPods = new Set(['main/clock1'])
const placed = (r: string, p: string) => placedPods.has(`${r}/${p}`)
const warned = spyOn(console, 'warn').mockImplementation(() => {})   // pagesOf warns on each bad page, as expected here
const refused = (r: { ok: boolean }) => expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })

test('Main is there and first, even when not given', () => {
  expect(pageStore([], placed).list()).toEqual([main])
  expect(pageStore([trading, { ...main, title: 'Home' }], placed).list().map(p => p.id)).toEqual(['workspace', 'trading'])
})

test('the initial pages are checked: a bad one or a fixed route dropped, the first of an id kept', () => {
  warned.mockClear()
  const s = pageStore([main, trading, { ...trading, title: 'Again' }, { id: 'a/b', title: 'x', slots: [] }, { id: 'ring', title: 'R', slots: [] }], placed)
  expect(s.list()).toEqual([main, trading])
  expect(warned).toHaveBeenCalledTimes(1)
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

test('slugPath slugs a title and avoids taken routes', () => {
  expect(slugPath('My Desk', ['/my-desk'])).toBe('/my-desk-2')
  expect(slugPath('My Desk', ['/my-desk', '/my-desk-2'])).toBe('/my-desk-3')
  expect(slugPath('  ', [])).toBe('/workspace-page')
})

test('merge: a free id is added as it is; a taken id with identical content is skipped, so a repeat is a no-op', () => {
  const s = pageStore([main], placed)
  expect(s.merge([trading])).toEqual([])
  expect(s.list()).toEqual([main, trading])
  expect(s.merge([structuredClone(trading)])).toEqual([])
  expect(s.list()).toEqual([main, trading])
})

test('merge: a taken id with other content is added as -2, -3…; the incoming workspace is not a Main that has slots', () => {
  const full = { ...main, slots: [{ id: 'n', view: 'nano-explorer' }] }, s = pageStore([full], placed), other = { ...trading, title: 'Other' }
  s.merge([trading, other, { ...trading, title: 'Third' }])
  expect(s.list().map(p => [p.id, p.title])).toEqual([['workspace', 'Workspace'], ['trading', 'Trading'], ['trading-2', 'Other'], ['trading-3', 'Third']])
  s.merge([{ ...main, title: 'Imported', slots: [{ id: 'a', runtime: 'main', pod: 'clock1' }] }, structuredClone(full)])   // the second is identical to Main: skipped
  expect(s.list()[0]).toEqual(full)
  expect(s.get('workspace-2')?.title).toBe('Imported')
  expect(s.list().length).toBe(5)
})

test('merge: the incoming workspace fills a Main with no slots (after New): its slots, engine keys and title; no workspace-2', () => {
  const s = pageStore([{ ...main, workspace: { root: 1 } }], placed), saved = { ...main, title: 'Main', slots: trading.slots, workspace: { root: 2 } }
  expect(s.merge([saved])).toEqual([])
  expect(s.list()).toEqual([saved])
})

test('merge: set\'s refusals come back as messages, the rest still added; a deleted page imported again is added back', () => {
  const s = pageStore([main], placed)
  const out = s.merge([{ id: 'ring', title: 'R', slots: [] }, { id: 'x', title: 'X', slots: [{ id: 'q', runtime: 'main', pod: 'nope' }] }, trading])
  expect(out.length).toBe(2)
  expect(out[0]).toContain('ring'); expect(out[1]).toContain('nope')
  expect(s.list().map(p => p.id)).toEqual(['workspace', 'trading'])
  s.remove('trading')
  expect(s.merge([trading])).toEqual([])
  expect(s.list().map(p => p.id)).toEqual(['workspace', 'trading'])
})
