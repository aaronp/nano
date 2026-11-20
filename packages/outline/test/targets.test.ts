// `targets`: a placed pod as a selector sees it, as auto-connect has always built it.
import { expect, test } from 'bun:test'
import { matches, Registry, type AppDeployment } from '@pritzlaff/nano-core'
import kv from '../../../examples/kv/memory.ts'
import messaging from '../../../examples/chat/messaging/kv.ts'
import { targets } from '../src/index.ts'

const registry = Registry.create()
for (const p of [kv, messaging]) registry.add(p)
const d: AppDeployment = {
  pods: { store: { implementation: 'example.kv/memory', eager: false }, ghost: { implementation: 'nope/none', eager: false } },
  runtimes: { r: { pods: ['store', 'ghost'], subscriptions: [] } }, tags: { store: ['primary'] },
}

test('a known pod: its name, runtime, implementation, provider, interfaces and tags', () => {
  const t = targets(d, registry)('store', 'r')!
  expect({ ...t, provides: [...t.provides], tags: [...t.tags] }).toEqual({
    name: 'store', runtime: 'r', implementation: 'example.kv/memory', provider: 'example.kv',
    provides: registry.implementation('example.kv/memory')!.provides.map(i => i.coord), tags: ['primary'],
  })
  expect(matches({ tags: ['primary'] }, t)).toBe(true)
})

test('an unknown pod or implementation: undefined', () => {
  expect(targets(d, registry)('ghost', 'r')).toBeUndefined()
  expect(targets(d, registry)('nobody', 'r')).toBeUndefined()
})
