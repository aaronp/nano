/**
 * The wiring view: the circuit of a deployment, and the mounted <nano-wiring> lighting a cable per message.
 */
import { describe, expect, test } from 'bun:test'
import { Application, assemble, createRegistry, Pod, port, type AppDeployment, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { circuitOf, Debounce, debounce, defineViews, input, Input, Log, log, map, MapIface } from '../src/index.ts'
import './dom.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const slice: AppDeployment = {
  pods: { in: Pod.eager(input), wait: Pod.eager(debounce, { config: { quietMs: 10 } }), up: Pod.lazy(map, { config: { code: 'return x' } }), out: Pod.lazy(log) },
  runtimes: { main: { pods: ['in', 'wait', 'up', 'out'], subscriptions: [
    { kind: 'pipe', from: 'in', source: port(Input, Input.ops.submit), to: 'wait', target: port(Debounce, Debounce.ops.push) },
    { kind: 'pipe', from: 'wait', source: port(Debounce, Debounce.ops.flushed), to: 'up', target: port(MapIface, MapIface.ops.map) },
    { kind: 'pipe', from: 'up', source: port(MapIface, MapIface.ops.map), to: 'out', target: port(Log, Log.ops.log) },
  ] } },
}
const registry = () => { const r = createRegistry(); r.add(uiProvider); return r }
const join = (c: ReturnType<typeof circuitOf>, i: number) => {
  const cable = c.cables[i]!, pad = (key: string) => c.layers.flatMap(l => l.footprints).flatMap(f => f.pads).find(p => p.key === key)!
  return `${pad(cable.from.pad).instance}.${pad(cable.from.pad).label}→${pad(cable.to.pad).instance}.${pad(cable.to.pad).label}`
}

describe('circuitOf', () => {
  test('given the slice, then one layer, four footprints, and three cables joining in.submit→wait.push, wait.flushed→up.map, up.map→out.log', () => {
    const c = circuitOf(slice, registry())
    expect(c.layers.map(l => [l.screen, l.footprints.map(f => f.instance)])).toEqual([['main', ['in', 'wait', 'up', 'out']]])
    expect(c.cables.map((_, i) => join(c, i))).toEqual(['in.submit→wait.push', 'wait.flushed→up.map', 'up.map→out.log'])
    expect(c.side).toEqual([])
  })

  test('given a pod in two runtimes, then it has a footprint on each layer and one side block', () => {
    const d: AppDeployment = { pods: { out: Pod.lazy(log) }, runtimes: { a: { pods: ['out'], subscriptions: [] }, b: { pods: ['out'], subscriptions: [] } } }
    const c = circuitOf(d, registry())
    expect(c.layers.map(l => l.footprints.map(f => f.instance))).toEqual([['out'], ['out']])
    expect(c.side.map(b => b.system)).toEqual(['out'])
    expect(c.cables.map(k => [k.from.at, k.to.at])).toEqual([[{ layer: 'a' }, { side: 'out' }], [{ layer: 'b' }, { side: 'out' }]])
  })

  test('given a call edge, then it is a cable of type call', () => {
    const d: AppDeployment = { pods: { up: Pod.lazy(map), out: Pod.lazy(log) }, runtimes: { r: { pods: ['up', 'out'], subscriptions: [{ kind: 'call', from: 'up', to: 'out' }] } } }
    expect(circuitOf(d, registry()).cables.map(c => c.type)).toEqual(['call'])
  })
})

describe('<nano-wiring>', () => {
  test('given a mounted nano-wiring, when in.submit is called, then the in→wait cable is lit, and dims after 600ms', async () => {
    defineViews()
    const reg = registry(), app = must(await Application.create(must(assemble(slice, reg)), {}))
    const el = document.createElement('nano-wiring') as HTMLElement & { target: unknown; updateComplete: Promise<unknown> }
    el.target = { app, registry: reg }
    document.body.append(el)
    await el.updateComplete
    const lit = () => [...el.shadowRoot!.querySelectorAll('path[data-cable]')].filter(p => p.getAttribute('data-lit') === 'true').map(p => p.getAttribute('data-cable'))
    expect(lit()).toEqual([])
    await app.call('main', 'in').submit('x')
    await el.updateComplete
    expect(lit()).toEqual(['main|in|wait|' + port(Debounce, Debounce.ops.push) + '|' + port(Input, Input.ops.submit)])
    await new Promise(r => setTimeout(r, 650))
    await el.updateComplete
    expect(lit()).toEqual([])
  })
})
