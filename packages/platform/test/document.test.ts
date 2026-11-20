// The UIDeployment's written form: coordinates and selectors as strings, read back by `Platform.parse`; malformed refused whole.
import { expect, test } from 'bun:test'
import { Coord } from '@pritzlaff/nano-core'
import { Platform, readSelector, type UIDeployment } from '../src/index.ts'

const acme = Coord.namespace('acme')
const doc: UIDeployment = { pages: {
  home: { slots: {
    a: { kind: 'pod', pod: Coord.pod(acme.implementationId('counter'), Coord.runtime('r'), 'c') },
    b: { kind: 'select', select: { implements: acme.interfaceId('Counter'), tags: ['x'], runtime: Coord.runtime('s') } },
    c: { kind: 'view', view: 'nano-systems' },
  }, layout: { engine: 1 }, meta: { title: 'Home' } },
  empty: { slots: {} },
} }

test('serialised, coordinates and selectors are strings; parsed, they are coordinates again', () => {
  const written = JSON.parse(JSON.stringify(doc))
  expect(written.pages.home.slots.a.pod).toBe('acme/counter@r/c')
  expect(written.pages.home.slots.b.select).toEqual({ implements: 'acme.Counter', tags: ['x'], runtime: 's' })
  const r = Platform.parse(written)
  if (!r.ok) throw new Error(r.fail.reason)
  expect(JSON.stringify(r.value)).toBe(JSON.stringify(doc))
  const a = r.value.pages.home!.slots.a!
  expect(a.kind === 'pod' && a.pod.kind).toBe('pod')
})

test('malformed input is refused whole, naming the page and slot', () => {
  const bad = (f: (w: any) => void) => { const w = JSON.parse(JSON.stringify(doc)); f(w); return Platform.parse(w) }
  for (const r of [
    bad(w => { w.pages.home.slots.a.pod = 'nope' }),
    bad(w => { w.pages.home.slots.a.kind = 'other' }),
    bad(w => { w.pages.home.slots.b.select.implements = 'no dot' }),
    bad(w => { w.pages.home.slots.a.extra = 1 }),
  ]) expect(r).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: expect.stringMatching(/page home, slot [ab]/) } })
  expect(bad(w => { w.pages['a/b'] = { slots: {} } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  expect(Platform.parse({ pages: [] })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  expect(Platform.parse(null)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
})

test('readSelector reads only the selector fields, each to its coordinate', () => {
  const s = readSelector({ implements: 'acme.Counter', implementation: 'acme/counter', provider: 'acme', runtime: 'r', tags: ['t'], byCoord: {} })
  expect(Object.keys(s).sort()).toEqual(['implementation', 'implements', 'provider', 'runtime', 'tags'])
  expect([s.implements!.kind, s.implementation!.kind, s.provider!.kind, s.runtime!.kind]).toEqual(['interface', 'implementation', 'namespace', 'runtime'])
  expect(() => readSelector({ implements: 'bad' })).toThrow()
})
