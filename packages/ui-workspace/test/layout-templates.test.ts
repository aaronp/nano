import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'
import { enabledFor, panelsInOrder, swap, templateState } from '../src/lib/layout-templates.ts'

test('panels come in reading order', () => {
  const c = (w: string) => ({ type: 'component', componentState: { widget: w } })
  const root = { type: 'row', content: [c('a'), { type: 'column', content: [c('b'), { type: 'stack', content: [c('c'), c('d')] }] }] }
  expect(panelsInOrder(root).map(p => p.widget)).toEqual(['a', 'b', 'c', 'd'])
})
test('a pod panel keeps its name', () => expect(panelsInOrder({ type: 'component', componentState: { widget: 'pod', name: 'up1' } })).toEqual([{ widget: 'pod', name: 'up1' }]))
test('enabled templates match the count exactly; dock always', () => {
  expect([...enabledFor(2)].sort()).toEqual(['dock', 'main-drawer', 'two-cols', 'two-rows'])
  expect([...enabledFor(4)].sort()).toEqual(['dock', 'grid'])
  expect([...enabledFor(5)]).toEqual(['dock'])
})
test('swap exchanges two positions without mutating', () => { const o = ['a','b','c']; expect(swap(o, 0, 2)).toEqual(['c','b','a']); expect(o).toEqual(['a','b','c']) })
test('template state: unknown id, wrong count and junk read as null', () => {
  const s = templateState(localStorage, 'k')
  s.set({ template: 'two-cols', order: [{ widget: 'a' }, { widget: 'b' }], dock: { root: null } })
  expect(s.get()?.template).toBe('two-cols')
  localStorage.setItem('k.template', JSON.stringify({ template: 'nope', order: [], dock: null })); expect(s.get()).toBeNull()
  localStorage.setItem('k.template', JSON.stringify({ template: 'grid', order: [{ widget: 'a' }], dock: null })); expect(s.get()).toBeNull()
  localStorage.setItem('k.template', '{'); expect(s.get()).toBeNull()
  s.set(null); expect(localStorage.getItem('k.template')).toBeNull()
})
