// Performance and scalability probe (not a test): bun packages/runes/bench.ts
import { Type } from 'typebox'
import { Components, Ops, Registries, Runtimes } from '@pritzlaff/nano-core'
import { component, state } from './src'

const time = async (label: string, n: number, fn: (i: number) => unknown) => {
  for (let i = 0; i < Math.min(n, 200); i++) await fn(i)   // warm up
  const t = performance.now()
  for (let i = 0; i < n; i++) await fn(i)
  const us = ((performance.now() - t) * 1000) / n
  console.log(`${label.padEnd(56)} ${us.toFixed(2).padStart(10)} µs/op ${Math.round(1e6 / us).toLocaleString().padStart(12)} op/s`)
}

const Sink = Ops.sink('b', 'take', Type.Unknown()), Src = Ops.source('b', 'out', Type.Number())
const sink = () => { const c = Components.create({ ns: 'b', name: 'sink' }, () => 0); c.action(Sink, () => {}); return Components.instantiate(c) }
const source = () => { const c = Components.create({ ns: 'b', name: 'src' }, () => 0); c.action(Src); return Components.instantiate(c) }
const me = { registry: 'r', instance: 'me' }

{
  const rt = Runtimes.create(Registries.create('r')); rt.registry.add('s', sink())
  await time('core call → one action', 100_000, () => rt.call(me, 's', 'b/take', 1))
}
for (const n of [1, 10, 100, 1000]) {
  const rt = Runtimes.create(Registries.create('r')), reg = rt.registry, src = source()
  reg.add('src', src)
  for (let i = 0; i < n; i++) { reg.add(`l${i}`, sink()); reg.subscribe({ source: 'src', op: 'b/out', listener: `l${i}`, target: 'b/take' }) }
  await time(`notify → ${n} subscribers`, Math.max(100, 100_000 / n), () => src.env.notify(Src, 1))
}
for (const n of [10, 1000, 10_000]) {
  const rt = Runtimes.create(Registries.create('r')), reg = rt.registry, src = source()
  reg.add('src', src); reg.add('l', sink())
  reg.subscribe({ source: 'src', op: 'b/out', listener: 'l', target: 'b/take' })
  for (let i = 0; i < n; i++) reg.subscribe({ source: `other${i}`, op: 'b/out', listener: 'l', target: 'b/take' })
  await time(`notify → 1 match among ${n} other subscriptions`, 2000, () => src.env.notify(Src, 1))
}
{
  const reg = Registries.create('r'); Runtimes.create(reg)
  const t = performance.now()
  for (let i = 0; i < 10_000; i++) reg.add(`i${i}`, sink())
  console.log(`${'registry.add × 10k (with runtime)'.padEnd(56)} ${(performance.now() - t).toFixed(1).padStart(10)} ms total`)
}
for (const [getters, items] of [[1, 10], [10, 10], [100, 10], [1, 1000], [10, 1000]] as const) {
  const C = component('b/many', () => {
    const s = state({ n: 0, items: Array.from({ length: items }, (_, i) => i) })
    const api: Record<string, unknown> = { bump: () => { s.n++ } }
    for (let g = 0; g < getters; g++) Object.defineProperty(api, `g${g}`, { get: () => (g === 0 ? s.n : s.items), enumerable: true })
    return api
  })
  const rt = Runtimes.create(Registries.create('r')); rt.registry.add('c', Components.instantiate(C))
  await time(`runes write+flush: ${getters} getters, ${items} items`, 2000, async () => { await rt.call(me, 'c', 'b/many/bump', null); await Promise.resolve() })
}
