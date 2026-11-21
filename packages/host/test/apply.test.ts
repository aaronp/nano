// `host.apply(next)`: what `next` names and the registry lacks is loaded by the host's loader (as at boot), then the
// system applied; its modules are the document's from then on, so a reboot from storage loads them. A failed load
// applies nothing and records nothing.
import { expect, test } from 'bun:test'
import { failure } from '@pritzlaff/nano-core'
import { Host } from '../src/index.ts'

const KEY = 'nano-host.document', base = import.meta.url
const memory = (): Storage & { m: Map<string, string> } => {
  const m = new Map<string, string>()
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as never
}
const boot = async (s: Storage, opts: Partial<Parameters<typeof Host.boot>[1]> = {}) => {
  const r = await Host.boot(s, { base, ...opts })
  if (!r.ok) throw new Error(r.fail.reason)
  return r.value
}
const acme = { pods: { t1: { implementation: 'acme/thing', eager: false } }, runtimes: { main: { pods: ['t1'], subscriptions: [] } }, modules: { acme: './acme.ts' } }

test('an apply that adds a module loads it, records it, and a reboot from storage loads it', async () => {
  const s = memory(), asked: unknown[] = []
  const h = await boot(s)
  const load: NonNullable<Parameters<typeof Host.boot>[1]['load']> = async (m, b, app) => { asked.push([m, app.pods]); const { Registry } = await import('@pritzlaff/nano-core'); return Registry.load(m, b) }
  const again = await boot(s, { load })   // a second host on the same storage, its loader watched
  expect(asked).toEqual([])   // nothing to load
  expect(await again.apply(acme)).toMatchObject({ ok: true })
  expect(asked).toEqual([[{ acme: './acme.ts' }, acme.pods]])   // the app document beside the modules
  expect(again.registry.implementation('acme/thing')).toBeDefined()
  expect(Object.keys(again.exports)).toEqual(['acme'])
  expect(JSON.parse(s.m.get(KEY)!).app.modules).toEqual({ acme: './acme.ts' })
  expect(await again.apply({ ...again.app.deployment() })).toMatchObject({ ok: true })   // no modules given: kept
  expect(again.document().app.modules).toEqual({ acme: './acme.ts' })
  expect(asked.length).toBe(1)   // loaded once
  void h
  const reboot = await boot(s)
  expect(Object.keys(reboot.app.deployment().pods)).toEqual(['t1'])
  expect(reboot.registry.implementation('acme/thing')).toBeDefined()
})

test('a failed load applies nothing and records nothing', async () => {
  const s = memory()
  const h = await boot(s, { load: async () => failure('invalid-input', 'refused') })
  const saved = s.m.get(KEY)
  expect(await h.apply(acme)).toMatchObject({ ok: false, fail: { reason: 'refused' } })
  expect(h.app.deployment().pods).toEqual({})
  expect(h.document().app.modules).toBeUndefined()
  expect(s.m.get(KEY)).toBe(saved!)
})

test('a failed apply keeps the modules as they were', async () => {
  const h = await boot(memory())
  expect(await h.apply({ pods: { x: { implementation: 'acme/none', eager: false } }, runtimes: { main: { pods: ['x'], subscriptions: [] } }, modules: { acme: './acme.ts' } })).toMatchObject({ ok: false })
  expect(h.document().app.modules).toBeUndefined()
})
