// The dock's window styles: Tabs, or Distraction free (a lone panel shows no tab, and its controls only on hover).
import { expect, test } from 'bun:test'
import { WINDOW_STYLES, windowStyle } from '../src/lib/dock-layout.ts'

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } } }

test('the window style defaults to tabs, is remembered per dock, and ignores anything unknown', () => {
  const store = memory()
  expect(WINDOW_STYLES.map(s => s.id)).toEqual(['tabs', 'focus'])
  expect(windowStyle(store, 'ws').get()).toBe('tabs')
  windowStyle(store, 'ws').set('focus')
  expect(windowStyle(store, 'ws').get()).toBe('focus')
  expect(windowStyle(store, 'other').get()).toBe('tabs')
  store.setItem('ws.window-style', 'bogus')
  expect(windowStyle(store, 'ws').get()).toBe('tabs')
})
