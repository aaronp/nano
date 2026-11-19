// Saved workspace pages: add, update, and a route change moving the dock's keys.
import { expect, test } from 'bun:test'
import { savedWorkspaces } from '../src/lib/saved-workspaces.ts'

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
