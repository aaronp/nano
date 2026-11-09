// A page to test components on: a registry with a runtime, calls by op, and a spy on what a source publishes.
import { Components, Ops, Registries, Runtimes, type Component, type Op } from '@pritzlaff/nano-core'
import { component } from '@pritzlaff/nano-runes'

export const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const Spy = component('test/spy', () => { const got: unknown[] = []; return { get got() { return got }, take: (x: unknown) => { got.push(x) } } })

export const page = () => {
  const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
  const add = (id: string, c: Component) => { reg.add(id, Components.instantiate(c)); return id }
  const call = (id: string, op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, id, Ops.key(op), arg) as Promise<any>
  const value = async (id: string, op: Op) => (await call(id, op)).value
  const spy = (source: string, op: Op) => {
    const id = add(`spy-${Math.random()}`, Spy)
    reg.subscribe({ source, op: Ops.key(op), listener: id, target: Ops.key(Spy.ops.take) })
    return (reg.get(id)!.value as { got: unknown[] }).got
  }
  return { rt, reg, add, call, value, spy }
}
