// Saved workspace pages: add, update, and a route change moving the dock's keys.
import { expect, test } from 'bun:test'
import { savedWorkspaces, slugPath } from '../src/lib/saved-workspaces.ts'

const memory = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } } }
const a = { path: '/a', title: 'A', icon: 'star' }

test('add appends and lists; a taken path is refused', () => {
  const s = savedWorkspaces(memory())
  expect(s.add(a, ['/'])).toBeNull()
  expect(s.list()).toEqual([a])
  expect(s.add({ ...a, title: 'B' }, [])).toContain('already')
  expect(s.add({ ...a, path: '/' }, ['/'])).toContain('route')
  expect(s.list()).toEqual([a])
})

test('update keeps the path for a title or icon change', () => {
  const s = savedWorkspaces(memory()); s.add(a, [])
  expect(s.update('/a', { ...a, title: 'Z', icon: 'box' }, [], 'm')).toBeNull()
  expect(s.list()).toEqual([{ path: '/a', title: 'Z', icon: 'box' }])
})

test('update to a new route moves the dock keys; a taken route is refused and moves nothing', () => {
  const st = memory(), s = savedWorkspaces(st)
  s.add(a, []); s.add({ ...a, path: '/c' }, [])
  for (const x of ['', '.template', '.window-style']) st.setItem('m.saved./a' + x, 'v' + x)
  expect(s.update('/a', { ...a, path: '/c' }, [], 'm')).toContain('already')
  expect([...st.m.keys()].filter((k) => k.startsWith('m.'))).toEqual(['m.saved./a', 'm.saved./a.template', 'm.saved./a.window-style'])
  expect(s.update('/a', { ...a, path: '/b' }, [], 'm')).toBeNull()
  expect([...st.m.keys()].filter((k) => k.startsWith('m.')).sort()).toEqual(['m.saved./b', 'm.saved./b.template', 'm.saved./b.window-style'])
  expect(st.m.get('m.saved./b.template')).toBe('v.template')
  expect(s.list().map((w) => w.path)).toEqual(['/b', '/c'])
})

test('a storage that will not write is a refusal, not a throw', () => {
  const st = { ...memory(), setItem: () => { throw new Error('quota') } }, s = savedWorkspaces(st)
  expect(s.add(a, [])).toBe('Could not save: quota')
  expect(s.update('/a', a, [], 'm')).toBe('Could not save: quota')
})

test('slugPath slugs a title and avoids taken routes', () => {
  expect(slugPath('My Desk', ['/my-desk'])).toBe('/my-desk-2')
  expect(slugPath('My Desk', ['/my-desk', '/my-desk-2'])).toBe('/my-desk-3')
  expect(slugPath('  ', [])).toBe('/workspace-page')
})

test('move reorders; unknown or unchanged is false', () => {
  const s = savedWorkspaces(memory())
  for (const p of ['/a', '/b', '/c']) s.add({ ...a, path: p }, [])
  expect(s.move('/c', 0)).toBe(true)
  expect(s.list().map((w) => w.path)).toEqual(['/c', '/a', '/b'])
  expect(s.move('/c', 0)).toBe(false)
  expect(s.move('/zz', 1)).toBe(false)
})

test('setMain stores Main\'s title and icon; empty title or unknown icon is refused', () => {
  const s = savedWorkspaces(memory())
  expect(s.main()).toBeNull()
  expect(s.setMain({ title: 'Desk', icon: 'home' })).toBeNull()
  expect(s.main()).toEqual({ title: 'Desk', icon: 'home' })
  expect(s.setMain({ title: '', icon: 'home' })).toContain('title')
  expect(s.setMain({ title: 'X', icon: 'nope' })).toContain('icon')
  expect(s.main()).toEqual({ title: 'Desk', icon: 'home' })
})
