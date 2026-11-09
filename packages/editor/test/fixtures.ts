// A page to test components on: a registry with a runtime, and a spy that records what it is sent.
import { Components, Ops, Registries, Runtimes, type Component, type Op } from '@composable/core'
import { component } from '@composable/runes'
import { Type } from 'typebox'
import { brandOf } from '../src/model'

export const tick = () => new Promise(r => setTimeout(r, 0))

const Spy = component('test/spy', () => {
  const got: unknown[] = []
  return { get got() { return got }, take: (x: unknown) => { got.push(x) } }
})

export const page = () => {
  const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
  const add = (id: string, c: Component) => { reg.add(id, Components.instantiate(c)); return id }
  const call = (id: string, op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, id, Ops.key(op), arg) as Promise<any>
  const value = async (id: string, op: Op) => (await call(id, op)).value
  /** Records everything `source` publishes on `op`. */
  const spy = (source: string, op: Op) => {
    const id = `spy-${Math.random()}`
    add(id, Spy)
    reg.subscribe({ source, op: Ops.key(op), listener: id, target: Ops.key(Spy.ops.take) })
    return (reg.get(id)!.value as { got: unknown[] }).got
  }
  return { rt, reg, add, call, value, spy }
}

// The demo's components, as list entries: their ops carry the schemas the board joins on.
const num = Type.Number({ title: 'number' }), meters = brandOf(num, 'Meters')
export const demo = {
  slider: { id: 'slider', ops: [Ops.source('demo/slider', 'value-changed', num), Ops.action('demo/slider', 'set', num, num)] },
  doubler: { id: 'doubler', ops: [Ops.action('demo/doubler', 'map', num, num)] },
  chart: { id: 'chart', ops: [Ops.sink('demo/chart', 'push', num)] },
  meter: { id: 'meter', ops: [Ops.sink('demo/meter', 'show', meters)] },
  log: { id: 'log', ops: [Ops.sink('demo/log', 'write', Type.Unknown({ title: 'unknown' }))] },
}
