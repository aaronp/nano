import { expect, test } from 'bun:test'
import type { NanoApp } from '@composable/shell'
import { appStore } from '../src/app/store'

const memory = (limit = Infinity) => {
  const m = new Map<string, string>()
  return { m, getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { if ([...m].reduce((n, [, x]) => n + x.length, 0) + v.length > limit) throw new Error('quota exceeded'); m.set(k, v) } }
}
const a = (title: string): NanoApp => ({ nano: 1, title, imports: [], systems: [], workspaces: [] })

test('the working copy, named apps and the current name are kept, and read back checked', () => {
  const s = memory(), st = appStore(s)
  expect(st.working()).toBeNull(); expect(st.name()).toBeNull(); expect(st.apps()).toEqual({})
  expect(st.setWorking(a('W'))).toBeNull(); expect(appStore(s).working()).toEqual(a('W'))
  expect(st.save('one', a('One'))).toBeNull(); expect(st.save('two', a('Two'))).toBeNull()
  expect(Object.keys(st.apps())).toEqual(['one', 'two'])
  st.setName('one'); expect(st.name()).toBe('one'); st.setName(null); expect(st.name()).toBeNull()
  s.m.set('nano.working', '{"nano":2}'); expect(st.working()).toBeNull()   // not a document: ignored
  s.m.set('nano.apps', JSON.stringify({ ok: a('Ok'), bad: { nano: 9 } })); expect(Object.keys(st.apps())).toEqual(['ok'])
})

test('dirty: no baseline or a difference is unsaved; the same document (any key order) is not', () => {
  const st = appStore(memory())
  expect(st.dirty(a('X'))).toBe(true); expect(st.needsBase()).toBe(true)
  st.setBase(a('X')); expect(st.needsBase()).toBe(false)
  expect(st.dirty(a('X'))).toBe(false)
  expect(st.dirty({ workspaces: [], systems: [], imports: [], title: 'X', nano: 1 })).toBe(false)
  expect(st.dirty(a('Y'))).toBe(true)
})

test('a quota error is reported and nothing changes', () => {
  const s = memory(400), st = appStore(s)
  expect(st.save('small', a('S'))).toBeNull()
  const before = s.m.get('nano.apps')
  const r = st.save('big', a('B'.repeat(500)))
  expect(r).toContain('could not store'); expect(s.m.get('nano.apps')).toBe(before); expect(Object.keys(st.apps())).toEqual(['small'])
  expect(st.setWorking(a('W'.repeat(500)))).toContain('quota'); expect(st.working()).toBeNull()
})
