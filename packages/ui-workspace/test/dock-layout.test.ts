import { expect, test } from 'bun:test'
import { placementsOf } from '../src/lib/dock-layout.ts'

test('placementsOf reads named panels from a saved layout', () => {
  const layout = { root: { type: 'row', content: [
    { type: 'component', componentType: 'widget', id: 'gauge', title: 'Gauge', componentState: { widget: 'range', name: 'r1' } },
    { type: 'stack', content: [{ type: 'component', componentType: 'widget', id: '', title: 'Log', componentState: { widget: 'log' } },
      { type: 'component', componentType: 'widget', id: '', title: 'Other', componentState: { widget: 'log', name: 'l1' } }] },
  ] } }
  expect(placementsOf(layout)).toEqual([
    { panel: 'gauge', instance: 'r1', box: { x: 0, y: 0, w: 0.5, h: 1 } },
    { panel: 'Other@0.1.1', instance: 'l1', box: { x: 0.5, y: 0, w: 0.5, h: 1 }, tab: { group: '0.1', active: false } }])
})

test('placementsOf of null or junk is []', () => {
  for (const junk of [null, undefined, 3, 'x', [], {}, { root: 5 }, { root: { type: 'row', content: 'no' } }]) expect(placementsOf(junk)).toEqual([])
})

const C = (n: string) => ({ type: 'component', componentType: 'widget', id: n, title: n, componentState: { widget: 'w', name: n } })
const boxes = (layout: unknown) => Object.fromEntries(placementsOf(layout).map((p) => [p.panel, p.box]))
const near = (a: object, b: object) => { for (const k of ['x', 'y', 'w', 'h'] as const) expect((a as Record<string, number>)[k]).toBeCloseTo((b as Record<string, number>)[k]!, 9) }

test('a row of 30% and 70% splits the width', () => {
  const b = boxes({ root: { type: 'row', content: [{ ...C('A'), size: 30, sizeUnit: '%' }, { ...C('B'), size: 70, sizeUnit: '%' }] } })
  near(b.A!, { x: 0, y: 0, w: 0.3, h: 1 }); near(b.B!, { x: 0.3, y: 0, w: 0.7, h: 1 })
})

test('a column inside a row nests', () => {
  const b = boxes({ root: { type: 'row', content: [{ ...C('A'), size: 50, sizeUnit: '%' }, { type: 'column', size: 50, sizeUnit: '%', content: [C('B'), C('C')] }] } })
  near(b.B!, { x: 0.5, y: 0, w: 0.5, h: 0.5 }); near(b.C!, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
})

test("a stack's tabs share its box; one is active", () => {
  const ps = placementsOf({ root: { type: 'row', content: [C('A'), { type: 'stack', activeItemIndex: 1, content: [C('B'), C('D')] }] } })
  const [, b, d] = ps
  expect(b!.box).toEqual(d!.box)
  expect(b!.tab!.group).toBe(d!.tab!.group)
  expect([b!.tab!.active, d!.tab!.active]).toEqual([false, true])
  expect(ps[0]!.tab).toBeUndefined()
})

test('fr and missing sizes split proportionally and equally', () => {
  const fr = boxes({ root: { type: 'row', content: [{ ...C('A'), size: 1, sizeUnit: 'fr' }, { ...C('B'), size: 3, sizeUnit: 'fr' }] } })
  near(fr.A!, { x: 0, y: 0, w: 0.25, h: 1 }); near(fr.B!, { x: 0.25, y: 0, w: 0.75, h: 1 })
  const eq = boxes({ root: { type: 'column', content: [{ ...C('A'), size: 40, sizeUnit: '%' }, C('B'), C('C')] } })
  near(eq.A!, { x: 0, y: 0, w: 1, h: 0.4 }); near(eq.B!, { x: 0, y: 0.4, w: 1, h: 0.3 }); near(eq.C!, { x: 0, y: 0.7, w: 1, h: 0.3 })
})

test('boxes tile without overlap', () => {
  const ps = placementsOf({ root: { type: 'row', content: [
    { type: 'column', size: 2, sizeUnit: 'fr', content: [C('A'), { type: 'stack', content: [C('B'), C('D')] }, C('E')] },
    { type: 'column', size: 1, sizeUnit: 'fr', content: [C('F'), { ...C('G'), size: 25, sizeUnit: '%' }] },
  ] } })
  const seen = new Set<string>()
  let area = 0
  for (const p of ps) { const k = JSON.stringify(p.box); if (seen.has(k)) continue; seen.add(k); area += p.box.w * p.box.h }
  expect(area).toBeCloseTo(1, 9)
})
