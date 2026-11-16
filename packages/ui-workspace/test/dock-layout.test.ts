// The dock's layout, as data: the default arrangement, and pruning a saved one to the pods that exist.
import { expect, test } from 'bun:test'
import { defaultLayout, panel, panelIds, prune } from '../src/dock/layout.ts'

test('given pods a and b, then the default layout holds explorer, pod:a, pod:b, wiring and stream', () => {
  expect(panelIds(defaultLayout(['a', 'b']).dock.root)).toEqual(['explorer', 'pod:a', 'pod:b', 'wiring', 'stream'])
  expect(panelIds(defaultLayout([]).dock.root)).toEqual(['explorer', 'wiring', 'stream'])
})

test('given a layout naming pod:gone, then prune drops it, keeps the rest and keeps the active tab', () => {
  const saved = { dock: { root: { type: 'row', content: [panel('explorer'),
    { type: 'stack', activeItemIndex: 2, content: [panel('pod:gone'), panel('pod:a'), panel('pod:b')] }] } } }
  const { layout, dropped, invalid } = prune(saved, ['a', 'b'])
  expect(dropped).toEqual(['pod:gone'])
  expect(invalid).toBeUndefined()
  expect(panelIds(layout.dock.root)).toEqual(['explorer', 'pod:a', 'pod:b'])
  expect((layout.dock.root!.content![1] as { activeItemIndex: number }).activeItemIndex).toBe(1)   // still pod:b
})

test('given a stack left empty, then it goes too', () => {
  const saved = { dock: { root: { type: 'row', content: [panel('explorer'), { type: 'stack', content: [panel('pod:gone')] }] } } }
  expect(prune(saved, []).layout.dock.root).toEqual({ type: 'row', content: [panel('explorer')] })
})

test('given something that is not a layout, then prune gives the default, marked invalid', () => {
  for (const junk of ['nonsense', null, [], { dock: [] }, { dock: { root: { type: 'row', content: 'no' } } },
    { dock: { root: { type: 'component', componentType: 'panel', componentState: { id: 'elsewhere' } } } }])
    expect(prune(junk, ['a'])).toEqual({ layout: defaultLayout(['a']), dropped: [], invalid: true })
})
