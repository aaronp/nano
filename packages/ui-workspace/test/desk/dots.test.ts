// Desk dots: a frame's inFlight messages drawn on the cords, by the recorder spec's matching rules.
import '../wires/dom.ts'
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Pod, port, type NanoResult } from '@pritzlaff/nano-core'
import { input, Input, log, Log, type Frame, type Message, type TimeMachine } from '@pritzlaff/nano-ui'
import { defineDesk, type Desk } from '../../src/desk'
import { bezierAt } from '../../src/wires/geometry'
import type { Host } from '../../src/host.ts'
import { p1, registry, setup } from '../wires/setup'

defineDesk()
const tick = () => new Promise(r => setTimeout(r, 0))
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const msg = (kind: 'call' | 'pipe', from: string, to: string, p: string, at = 5, cause?: string, id = 'm1'): Message =>
  ({ seq: 1, at, sent: { type: 'sent', id, runtime: kind === 'pipe' ? 'main' : 'backend', kind, from, to, port: p, correlation: id, ...(cause && { cause }) } })
function fakeTm() {
  let fn: (f: Frame) => void = () => {}, frame: Frame = { t: 0, inFlight: [], recent: [] }
  const seeks: number[] = []
  const tm = { mode: 'paused', subscribe: (f: (f: Frame) => void) => { fn = f; return () => {} }, pause() { fn(frame) }, live() {}, seek: (t: number) => { seeks.push(t) } } as unknown as TimeMachine
  return { tm, seeks, emit: (inFlight: Frame['inFlight'], recent: Message[] = []) => { frame = { t: 0, inFlight, recent }; fn(frame) } }
}
async function mount(host: Host, t = fakeTm()) {
  const el = document.createElement('c-desk') as Desk
  el.host = host; el.tm = t.tm
  document.body.replaceChildren(el)
  const root = el.shadowRoot!, settle = async () => { await tick(); await tick(); await el.updateComplete }
  await settle()
  return { ...t, el, root, settle }
}
const dots = (root: ShadowRoot) => [...root.querySelectorAll('[data-dot]')] as SVGCircleElement[]
const at = (c: Element) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]

test('a pipe message at progress 0.5 is halfway along its pipe cord', async () => {
  const { root, emit, settle } = await mount((await setup()).host)
  emit([{ message: msg('pipe', 'r', 'd', p1.target), progress: 0.5 }]); await settle()
  expect(dots(root).length).toBe(1)
  const n = root.querySelector('path[data-pipe]')!.getAttribute('d')!.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number) as number[]
  const [x, y] = bezierAt({ a: [n[0]!, n[1]!], c1: [n[2]!, n[3]!], c2: [n[4]!, n[5]!], b: [n[6]!, n[7]!] }, 0.5)
  expect(Math.abs(at(dots(root)[0]!)[0]! - x)).toBeLessThan(2)
  expect(Math.abs(at(dots(root)[0]!)[1]! - y)).toBeLessThan(2)
})

async function chat() {
  const reg = registry(), d: AppDeployment = {
    pods: { alice: Pod.eager(input), store: Pod.eager(log) },
    runtimes: { room: { pods: ['alice'], subscriptions: [] }, backend: { pods: ['store'], subscriptions: [{ kind: 'call', from: 'alice', to: 'store' }] } },
  }
  const app = must(await Application.create(must(AppDeployment.assemble(d, reg))))
  return mount({ app, registry: reg, data: () => app.deployment(), document: () => ({ app: app.deployment(), outline: { roots: [], pages: {} } }), apply: (n: AppDeployment) => app.apply(n), calls: () => [] } as unknown as Host)
}

test('a call travels from the caller to the callee', async () => {
  const { root, emit, settle } = await chat(), m = msg('call', 'alice', 'store', port(Log, Log.ops.log))
  emit([{ message: m, progress: 0 }]); await settle()
  const start = at(dots(root)[0]!)
  emit([{ message: m, progress: 1 }]); await settle()
  const end = at(dots(root)[0]!)
  const d = root.querySelector('[data-call] path')!.getAttribute('d')!.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number)
  expect(start).toEqual([d[0]!, d[1]!])
  expect(Math.abs(end[0]! - d[6]!)).toBeLessThan(2)
  expect(end[0]!).toBeGreaterThan(start[0]!)
})

test('a host message draws no dot', async () => {
  const { root, emit, settle } = await mount((await setup()).host)
  emit([{ message: msg('call', 'ui', 'r', port(Input, Input.ops.submit)), progress: 0.5 }]); await settle()
  expect(dots(root).length).toBe(0)
})

test('clicking a dot pauses the timeline there and opens the detail', async () => {
  const { root, emit, seeks, settle } = await mount((await setup()).host), m = msg('pipe', 'r', 'd', p1.target, 42)
  emit([{ message: m, progress: 0.5 }]); await settle()
  expect(root.querySelector('[data-detail]')).toBeNull()
  dots(root)[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); await settle()
  expect(seeks).toEqual([42])
  expect(root.querySelector('[data-detail]')!.textContent).toContain('r → d')
})

test('without a time machine the Desk draws no dots', async () => {
  const el = document.createElement('c-desk') as Desk
  el.host = (await setup()).host; document.body.replaceChildren(el); await tick(); await el.updateComplete
  expect(el.shadowRoot!.querySelectorAll('[data-dot]').length).toBe(0)
})
