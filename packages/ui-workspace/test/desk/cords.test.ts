import '../wires/dom.ts'
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Pod, port, type NanoResult } from '@pritzlaff/nano-core'
import { input, Input, log, Log } from '@pritzlaff/nano-ui'
import { defineDesk, type Desk } from '../../src/desk'
import type { Host } from '../../src/host.ts'
import type { OpPair } from '../../src/wires/calls'
import { registry, setup } from '../wires/setup'

defineDesk()
const tick = () => new Promise(r => setTimeout(r, 0))
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
async function mount(host: Host, edit = false) {
  const el = document.createElement('c-desk') as Desk
  el.host = host
  document.body.append(el)
  const root = el.shadowRoot!, settle = async () => { await tick(); await tick(); await el.updateComplete }
  await settle()
  if (edit) { root.querySelector<HTMLElement>('[data-edit]')!.click(); await settle() }
  return { el, root, settle }
}
// chat-like: the caller alice is only in `room`; the call edge is listed in the callee's runtime `backend`
async function chat(calls: OpPair[] = []) {
  const reg = registry(), d: AppDeployment = {
    pods: { alice: Pod.eager(input), store: Pod.eager(log) },
    runtimes: { room: { pods: ['alice'], subscriptions: [] }, backend: { pods: ['store'], subscriptions: [{ kind: 'call', from: 'alice', to: 'store' }] } },
  }
  const app = must(await Application.create(must(AppDeployment.assemble(d, reg))))
  return mount({ app, registry: reg, data: () => app.deployment(), document: () => ({ app: app.deployment(), outline: { roots: [], pages: {} } }), apply: (n: AppDeployment) => app.apply(n), calls: () => calls } as unknown as Host)
}
const pair = (source: string | null): OpPair => ({ runtime: 'backend', from: 'alice', to: 'store', source, target: port(Log, Log.ops.log), declared: true, seen: true })

test('a call whose caller is only in another runtime is drawn (no observed pairs: from the caller column)', async () => {
  const { root } = await chat()
  expect(root.querySelectorAll('[data-call] path').length).toBeGreaterThan(0)
})

test('an observed op pair across runtimes is drawn op to op', async () => {
  const { root } = await chat([pair(port(Input, Input.ops.submit))])
  expect(root.querySelector('path[data-op-call="seen"]')).not.toBeNull()
})

test('a pair from an unknown op is drawn from the caller column', async () => {
  const { root } = await chat([pair(null)])
  expect(root.querySelectorAll('[data-call] path').length).toBeGreaterThan(0)
})

test('pipes are left-to-right S-curves, not hanging loops', async () => {
  const { root } = await mount((await setup()).host)
  const d = root.querySelector('path[data-pipe]')!.getAttribute('d')!
  const [ax, ay, c1x, c1y] = d.replace(/[MC]/g, ' ').trim().split(/[\s,]+/).map(Number) as number[]
  expect(c1y).toBe(ay)
  expect(c1x).toBeGreaterThan(ax)
})

test('Compact drops the implementation subtitle', async () => {
  const { root, settle } = await mount((await setup()).host)
  expect(root.querySelector('.col small')).not.toBeNull()
  root.querySelector<HTMLElement>('[data-compact]')!.click(); await settle()
  expect(root.querySelector('.col small') === null).toBe(true)
})

test('the selected cord is highlighted', async () => {
  const s = await setup(), { root, settle } = await mount(s.host, true)
  const cord = () => root.querySelector(`path[data-pipe="${s.s1.id}"]`)!
  expect(cord().hasAttribute('data-selected')).toBe(false)
  cord().dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); await settle()
  expect(cord().hasAttribute('data-selected')).toBe(true)
  expect(Number(cord().getAttribute('stroke-width'))).toBeGreaterThan(3)
})
