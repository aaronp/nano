// The Outline's pure `resolve`: a page's slots against a deployment, no app (the live outline's tests are the host core's).
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Coord, Implementation, Interface, Op, Pod, Provider, Registry, Schema, provide, success, type AppDeployment } from '@pritzlaff/nano-core'
import { resolve, type Outline } from '../src/index.ts'

const Num = Schema.define(Type.Integer(), 'Num')
const Counter = Interface.define('acme.Counter', { inc: Op.action(Num, Num) })
const counter = Implementation.define('acme/counter', { provides: [Counter], make: async () => [provide(Counter, { inc: async (n: number) => success(n + 1) })] })
const broken = Implementation.define('acme/broken', { provides: [Counter], make: async () => { throw new Error('cannot build') } })
const registry = Registry.create(); registry.add(Provider.define('acme', [counter, broken]))
const d: AppDeployment = {
  pods: { a: Pod.lazy(counter), b: Pod.lazy(counter), x: Pod.lazy(broken) },
  runtimes: { s: { pods: ['b'], subscriptions: [] }, r: { pods: ['a', 'x'], subscriptions: [] } },
}
const acme = Coord.namespace('acme'), impl = acme.implementationId('counter')
const at = (r: string, p: string, i = impl) => Coord.pod(i, Coord.runtime(r), p)
const strs = (v: unknown) => JSON.parse(JSON.stringify(v))

test('pod (where placed with that implementation), select (zero, one, several across runtimes), missing and tool', () => {
  const doc: Outline = { roots: ['home'], pages: { home: { slots: {
    a: { kind: 'pod', pod: at('r', 'a') }, wrongRuntime: { kind: 'pod', pod: at('s', 'a') }, wrongImpl: { kind: 'pod', pod: at('r', 'a', acme.implementationId('broken')) },
    gone: { kind: 'pod', pod: at('r', 'nobody') }, t: { kind: 'tool', tool: 'systems' }, none: { kind: 'select', select: { tags: ['nope'] } },
    one: { kind: 'select', select: { implementation: impl, runtime: Coord.runtime('s') } }, many: { kind: 'select', select: { implements: acme.interfaceId('Counter') } },
  } } } }
  expect(strs(resolve(doc, 'home', d, registry))).toEqual({ a: { kind: 'pod', pods: ['acme/counter@r/a'] }, wrongRuntime: { kind: 'missing' },
    wrongImpl: { kind: 'missing' }, gone: { kind: 'missing' }, t: { kind: 'tool', tool: 'systems' }, none: { kind: 'missing' },
    one: { kind: 'pod', pods: ['acme/counter@s/b'] }, many: { kind: 'pod', pods: ['acme/counter@r/a', 'acme/broken@r/x', 'acme/counter@s/b'] } })
  expect(resolve(doc, 'nowhere', d, registry)).toEqual({})
})
