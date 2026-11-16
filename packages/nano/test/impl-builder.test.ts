/**
 * `api.impl(coord)` (spec: docs/superpowers/specs/2026-11-16-layer-map-design.md, layer 2): an implementation starts
 * from the contract it provides; `needs`, `config`, `make`, `create` and `satisfies` all end in `Implementation.define`.
 */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Coord, Interface, Op, Provider, Registry, type NanoResult } from '../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const ns = Coord.namespace('acme')
const Counter = ns.interface('Counter', { inc: Op.action(Type.Null(), Type.Integer()) })
const Label = ns.interface('Label', { label: Op.action(Type.Null(), Type.String()) })

const counter = Counter.impl(ns.implementationId('counter')).make(() => { let n = 0; return { async inc() { return ++n } } })
const labelled = Label.impl(ns.implementationId('labelled'))
  .needs({ counter: Counter })
  .config(Type.Object({ prefix: Type.String() }))
  .make(({ deps, config }) => ({ async label() { return `${config.prefix satisfies string}${await deps.counter.inc()}` } }))
const created = Label.impl(ns.implementationId('created')).create({
  needs: { counter: Counter }, config: Type.Object({ prefix: Type.String() }),
  make: ({ deps, config }) => ({ async label() { return `${config.prefix}:${await deps.counter.inc()}` } }),
})
const both = Counter.impl(ns.implementationId('both'))
  .make(() => ({ async inc() { return 7 } }))
  .satisfies(Label, () => ({ async label() { return 'both' } }))

async function open(label: string, config: unknown) {
  const registry = Registry.create()
  must(registry.add(Provider.define('acme', [counter, labelled, created, both])))
  return must(await Application.create(must(AppDeployment.assemble({
    pods: { c: { implementation: 'acme/counter', eager: false }, l: { implementation: label, config, eager: false } },
    runtimes: { main: { pods: ['c', 'l'], subscriptions: [{ kind: 'call', from: 'l', to: 'c' }] } },
  }, registry))))
}

test('each form is an Implementation: coordinate, provides, dependencies and config as data', () => {
  expect(counter.coord).toBe('acme/counter')
  expect(counter.provides).toEqual([Counter])
  expect(labelled.dependencies).toEqual({ counter: { implements: 'acme.Counter' } })
  expect(labelled.config?.check({ prefix: 'x' })).toBe(true)
  expect(created.dependencies).toEqual(labelled.dependencies)
  expect(both.provides.map(i => i.coord)).toEqual(['acme.Counter', 'acme.Label'])
})

test('needs and config reach make, typed; create is the same in one call', async () => {
  expect(await (await open('acme/labelled', { prefix: '#' })).get(Label).label()).toBe('#1')
  expect(await (await open('acme/created', { prefix: 'n' })).get(Label).label()).toBe('n:1')
})

test('satisfies: each interface gets its own plain object from the same build', async () => {
  const registry = Registry.create()
  must(registry.add(Provider.define('acme', [both])))
  const app = must(await Application.create(must(AppDeployment.assemble({
    pods: { b: { implementation: 'acme/both', eager: false } }, runtimes: { main: { pods: ['b'], subscriptions: [] } },
  }, registry))))
  expect(await app.get(Counter).inc()).toBe(7)
  expect(await app.get(Label).label()).toBe('both')
})

test('make must give the interface: a wrong plain object does not type', () => {
  // @ts-expect-error inc must return a number
  void Counter.impl(ns.implementationId('wrong')).make(() => ({ async inc() { return 'x' } }))
})
