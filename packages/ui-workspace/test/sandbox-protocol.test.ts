import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes, isOk, type Trace } from '@pritzlaff/nano-core'
import type { Catalog } from '@pritzlaff/nano-elements'
import { Type } from 'typebox'
import { checkEntry, serialEntry, type Msg } from '../src/sandbox/protocol'
import { probe, serve } from '../src/sandbox/serve'
import { standIn, type Frame } from '../src/sandbox/stand-in'

const double = Ops.action('t', 'double', Type.Number(), Type.Number())
const tick = Ops.source('t', 'tick', Type.Number())
const fire = Ops.action('t', 'fire', Type.Number(), Type.Void())
const ask = Ops.action('t/deep', 'ask', Type.Number(), Type.Number())
const far = Ops.action('x/y', 'twice', Type.Number(), Type.Number())

const thing = () => {
  const c = Components.create({ ns: 't', name: 'thing' }, env => env, { description: 'a thing' })
  c.action(double, (_, n) => n * 2)
  c.action(tick)
  c.action(fire, async (env, n) => { await env.notify(tick, n) })
  c.action(ask, async (env, n) => { const r = await env.handles()[0]!.call('other', far, n); if (!isOk(r)) throw new Error(r.error); return r.value as number })
  return c
}
const catalog: Catalog = { thing: { component: thing(), title: 'Thing', tag: 'x-thing' } }
const entry = serialEntry(catalog.thing!)

const closers: (() => void)[] = []
afterEach(() => { closers.splice(0).forEach(f => f()) })
const deferred = () => { let resolve!: () => void, reject!: (e: Error) => void; const p = new Promise<void>((a, b) => { resolve = a; reject = b }); return { p, resolve, reject } }
const channel = () => { const ch = new MessageChannel(); closers.push(() => { ch.port1.close(); ch.port2.close() }); return ch }
const quiet = () => spyOn(console, 'warn').mockImplementation(() => {})

/** A host with a stand-in at 'box' (and an 'other' that doubles twice), and the far port. */
function host(ready = Promise.resolve()) {
  const ch = channel(), rt = Runtimes.create(Registries.create('h')), traces: Trace[] = []
  rt.listen(t => traces.push(t))
  const frame: Frame = { port: ch.port1, ready, dispose: () => {} }
  rt.registry.add('box', Components.instantiate(standIn(entry, () => frame)))
  const other = Components.create({ ns: 'o', name: 'other' }, () => ({}))
  other.action(far, (_, n) => n * 20)
  rt.registry.add('other', Components.instantiate(other))
  return { rt, far: ch.port2, traces, call: (op: string, arg: unknown) => rt.call({ registry: 'h', instance: 'test' }, 'box', op, arg) }
}
const next = (port: MessagePort) => new Promise<Msg>(res => { port.onmessage = e => res(e.data) })

describe('sandbox protocol', () => {
  test('calls round-trip through the port', async () => {
    const h = host()
    serve(h.far, catalog, 'thing')
    expect(await h.call('t/double', 4)).toEqual({ value: 8 })
    expect(await h.call('t/double', 'x')).toEqual({ error: 'invalid input for t/double' })
  })

  test('calls made before ready wait for it', async () => {
    const d = deferred(), h = host(d.p), got: Msg[] = []
    h.far.onmessage = e => got.push(e.data)
    const p = h.call('t/double', 1)
    await new Promise(r => setTimeout(r, 20))
    expect(got).toEqual([])
    d.resolve()
    await new Promise(r => setTimeout(r, 20))
    expect(got).toEqual([{ type: 'call', id: 1, op: 't/double', arg: 1 }])
    h.far.postMessage({ type: 'result', id: 1, result: { value: 2 } })
    expect(await p).toEqual({ value: 2 })
  })

  test("the served instance's publishes reach the stand-in's subscribers", async () => {
    const h = host()
    serve(h.far, catalog, 'thing')
    await h.call('t/fire', 7)
    await new Promise(r => setTimeout(r, 20))
    expect(h.traces.some(t => t.kind === 'publish' && t.from.instance === 'box' && t.op === 't/tick' && t.data === 7 && isOk(t.result))).toBe(true)
  })

  test("a result or publish failing its op's output schema is refused", async () => {
    const warn = quiet(), h = host()
    h.far.onmessage = e => { h.far.postMessage({ type: 'result', id: e.data.id, result: { value: 'nope' } }) }
    const r = await h.call('t/double', 1)
    expect(isOk(r)).toBe(false)
    h.far.postMessage({ type: 'publish', op: 't/tick', data: 'nope' })
    await h.call('t/double', 1)
    expect(h.traces.some(t => t.kind === 'publish' && t.op === 't/tick')).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test("a message naming an op the entry doesn't offer, or of unknown type, is dropped", async () => {
    const warn = quiet(), h = host()
    h.far.onmessage = e => { if (e.data.type === 'call') h.far.postMessage({ type: 'result', id: e.data.id, result: { value: 1 } }) }
    h.far.postMessage({ type: 'publish', op: 'z/nope', data: 1 })
    h.far.postMessage({ type: 'weird' })
    h.far.postMessage('junk')
    h.far.postMessage({ type: 'result', id: 99, result: { value: 1 } })
    expect(await h.call('t/double', 1)).toEqual({ value: 1 })
    expect(h.traces.some(t => t.kind === 'publish' && t.op === 'z/nope')).toBe(false)
    expect(warn).toHaveBeenCalledTimes(4)
    warn.mockRestore()
  })

  test("an outcall goes out through the stand-in's env and its result comes back", async () => {
    const h = host()
    serve(h.far, catalog, 'thing')
    expect(await h.call('t/deep/ask', 2)).toEqual({ value: 40 })
    const raw = host()   // the key splits at the last slash
    raw.far.postMessage({ type: 'outcall', id: 5, target: 'other', op: 'x/y/twice', arg: 1 })
    expect(await next(raw.far)).toEqual({ type: 'outresult', id: 5, result: { value: 20 } })
  })

  test('ready failing makes pending and later calls error', async () => {
    const d = deferred(), h = host(d.p)
    d.p.catch(() => {})
    const pending = h.call('t/double', 1)
    d.reject(new Error('boom'))
    const r = await pending, later = await h.call('t/double', 2)
    expect(r).toEqual({ error: 'box: boom' })
    expect(later).toEqual({ error: 'box: boom' })
  })

  test('a failed message while ready is pending fails the waiting call', async () => {
    const d = deferred(), h = host(d.p)
    const p = h.call('t/double', 1)
    h.far.postMessage({ type: 'failed', error: 'bad module' })
    expect(await p).toEqual({ error: 'box: bad module' })
    expect(await h.call('t/double', 1)).toEqual({ error: 'box: bad module' })
  })

  test('a ready message releases waiting calls while frame.ready is pending', async () => {
    const d = deferred(), h = host(d.p), got: Msg[] = []
    h.far.onmessage = e => got.push(e.data)
    const p = h.call('t/double', 1)
    h.far.postMessage({ type: 'ready' })
    await new Promise(r => setTimeout(r, 20))
    expect(got).toEqual([{ type: 'call', id: 1, op: 't/double', arg: 1 }])
    h.far.postMessage({ type: 'result', id: 1, result: { value: 2 } })
    expect(await p).toEqual({ value: 2 })
  })

  test('a schema that makes the check throw resolves the call with an error and drops the publish', async () => {
    const warn = quiet(), ch = channel(), rt = Runtimes.create(Registries.create('h')), traces: Trace[] = []
    rt.listen(t => traces.push(t))
    const evil = { ...entry, ops: [{ ...entry.ops.find(o => o.name === 'double')!, output: { type: 'string', pattern: '(' } }, ...entry.ops.filter(o => o.name === 'tick').map(o => ({ ...o, output: { type: 'string', pattern: '(' } }))] }
    rt.registry.add('box', Components.instantiate(standIn(evil as never, () => ({ port: ch.port1, ready: Promise.resolve(), dispose: () => {} }))))
    ch.port2.onmessage = e => ch.port2.postMessage({ type: 'result', id: e.data.id, result: { value: 'a' } })
    const r = await rt.call({ registry: 'h', instance: 't' }, 'box', 't/double', 1)
    expect(isOk(r)).toBe(false)
    ch.port2.postMessage({ type: 'publish', op: 't/tick', data: 'a' })
    await rt.call({ registry: 'h', instance: 't' }, 'box', 't/double', 1)
    expect(traces.some(t => t.kind === 'publish' && t.op === 't/tick')).toBe(false)
    warn.mockRestore()
  })

  test('after a failure publish and outcall messages are ignored', async () => {
    const warn = quiet(), h = host()
    h.far.postMessage({ type: 'failed', error: 'x' })
    h.far.postMessage({ type: 'publish', op: 't/tick', data: 1 })
    h.far.postMessage({ type: 'outcall', id: 1, target: 'other', op: 'x/y/twice', arg: 1 })
    const got: Msg[] = []
    h.far.onmessage = e => got.push(e.data)
    await new Promise(r => setTimeout(r, 20))
    await h.call('t/double', 1)
    expect(h.traces.some(t => t.kind === 'publish' && t.op === 't/tick')).toBe(false)
    expect(got).toEqual([])
    warn.mockRestore()
  })

  test('probe posts the catalog as data and checkEntry accepts it', async () => {
    const ch = channel()
    probe(ch.port2, catalog)
    const m = await next(ch.port1)
    expect(m.type).toBe('catalog')
    const e = (m as Extract<Msg, { type: 'catalog' }>).entries.thing
    expect(checkEntry(e)).toEqual(e as never)
    expect(e!.ops.map(o => `${o.ns}/${o.name}`)).toContain('t/deep/ask')
  })

  test('checkEntry returns only the known fields', () => {
    const r = checkEntry({ id: { ns: 'a', name: 'b', x: 1 }, title: 't', ops: [{ ns: 'a', name: 'o', evil: 1 }], component: {}, extra: 1 }) as unknown as Record<string, unknown>
    expect(r).toEqual({ id: { ns: 'a', name: 'b' }, title: 't', ops: [{ ns: 'a', name: 'o' }] })
  })

  test('checkEntry rejects malformed entries', () => {
    for (const bad of [null, 'x', {}, { ...entry, id: { ns: 1, name: 'a' } }, { ...entry, title: 3 }, { ...entry, tag: 3 }, { ...entry, ops: 'no' },
      { ...entry, ops: [{ ns: 't' }] }, { ...entry, ops: [{ ns: 't', name: 'a', input: 'str' }] },
      { ...entry, ops: [{ ns: 't', name: '' }] }, { ...entry, ops: [{ ns: 't', name: 'a/b' }] }, { ...entry, ops: [{ ns: 't', name: 'a' }, { ns: 't', name: 'a' }] }]) expect(typeof checkEntry(bad)).toBe('string')
  })
})
