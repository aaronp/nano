/**
 * The external signer, end to end: a `signer` runtime keeps the keys; the application places its `generator`,
 * `signer` and `map` pods into `signer-client`, where a tester uses them and a log shows the keys the vault stores.
 * Calls are provisioned (what a host does when a widget is added); events are connected by a person, each end chosen
 * with a selector, once. The vault is swapped at its home; the client, using it through the placed signer, sees it.
 *
 *   signer:         vault ← generator, vault ← signer (provisioned), vault.keys → map.format (connected)
 *   signer-client:  tester → generator, tester → signer (provisioned), map.line → log.append (connected)
 */
import { describe, expect, test } from 'bun:test'
import { Type, type Static } from 'typebox'
import {
  createApplication, createRegistry, defineSchema, iface, implementation, loadDoc, op, parseInstance, portKey, provide, provider, saveDoc, success,
  type Application, type EndSelector, type Interface, type NanoResult, type Op, type Runtime, type RuntimeEvent,
} from '@pritzlaff/nano'
import { KeyFormatter, Log, Signer, Tester, TestRequest, TestResult, Vault } from './interfaces.ts'
import { signerProvider } from './providers.ts'

const SIGNER = 'signer#0', TESTER = 'tester#0'
const DOC = new URL('./nano.json', import.meta.url)

/** The value, or a thrown error: setup steps that must work. */
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
/** A connection end as a person picks it: this pod, its first running instance. */
const first = (pod: string): EndSelector => ({ target: { pod }, instance: { by: 'first' } })
const port = (i: Interface, o: Op) => portKey(i.coord, o.coord)

/** What a host does when a person presses a button: call one of an instance's ops from outside. */
const press = (rt: Runtime, coord: string, i: Interface, o: Op, input: unknown) => rt.record(parseInstance(coord)!.pod)!.instances.get(coord)!.host!.invoke(port(i, o), input)
const runTest = (rt: Runtime, input: Static<typeof TestRequest.schema>) =>
  press(rt, TESTER, Tester, Tester.ops.test, input) as Promise<NanoResult<Static<typeof TestResult.schema>>>

/** A sink that takes anything: subscribe a source to it to see what the source publishes. */
function probe() {
  const seen: unknown[] = []
  const Probe = iface('example.probe.Probe', { see: op.sink('see', defineSchema('Anything', Type.Unknown())) })
  const impl = implementation('example.probe/probe', { provides: [Probe], make: () => [provide(Probe, { see: async (_ctx, v) => { seen.push(v); return success(undefined) } })] })
  return { provider: provider('example.probe', [impl]), seen, port: port(Probe, Probe.ops.see) }
}

function registry() {
  const r = createRegistry()
  r.add(signerProvider)
  return r
}

async function build(): Promise<Application> {
  const app = createApplication('app', { registry: registry() })
  const signer = must(app.createRuntime('signer'))
  const client = must(app.createRuntime('signer-client'))

  must(await signer.create('vault', 'example.signer/vault'))
  // Provisioning finds the one vault beside them and subscribes to it.
  must(await signer.create('generator', 'example.signer/generator', { provision: true }))
  must(await signer.create('signer', 'example.signer/signer', { provision: true }))
  must(await signer.create('map', 'example.signer/map'))
  must(signer.connect({ kind: 'event', from: first('vault'), source: port(Vault, Vault.ops.keys), to: first('map'), target: port(KeyFormatter, KeyFormatter.ops.format) }))

  for (const pod of ['generator', 'signer', 'map']) must(app.place(pod, 'signer', 'signer-client'))
  // Placed first, so provisioning finds the generator and signer in the client and subscribes the tester to them.
  must(await client.create('tester', 'example.signer/tester', { provision: true }))
  must(await client.create('log', 'example.signer/log'))
  must(client.connect({ kind: 'event', from: first('map'), source: port(KeyFormatter, KeyFormatter.ops.line), to: first('log'), target: port(Log, Log.ops.append) }))
  return app
}

/** Subscribes a probe to the log's `entries` in `signer-client`; `seen` holds every list it publishes. */
function watchLog(app: Application) {
  const p = probe()
  app.registry.add(p.provider)
  const client = app.runtime('signer-client')!
  return {
    seen: p.seen,
    ready: client.create('probe', 'example.probe/probe').then(() =>
      must(client.connect({ kind: 'event', from: first('log'), source: port(Log, Log.ops.entries), to: first('probe'), target: p.port }))),
  }
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const payload = btoa('hello')

async function verify(publicKey: string, signature: string, data: string) {
  const key = await crypto.subtle.importKey('raw', fromBase64(publicKey), { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify('Ed25519', key, fromBase64(signature), fromBase64(data))
}

describe('the external signer', () => {
  test('the tester gets a key and a signature that verifies', async () => {
    const app = await build()
    const r = await runTest(app.runtime('signer-client')!, { purpose: 'login', payload })
    if (!r.ok) throw new Error(r.fail.reason)
    const { publicKey, result } = r.value
    if (result.status !== 'signed') throw new Error(result.status)
    expect(await verify(publicKey, result.signature, payload)).toBe(true)
  })

  test('signing for another purpose is denied, as a value', async () => {
    const app = await build()
    const r = await runTest(app.runtime('signer-client')!, { purpose: 'login', payload, signAs: 'payments' })
    expect(r).toMatchObject({ ok: true, value: { result: { status: 'denied' } } })
  })

  test('the keys the vault stores reach the log in the client, through the map', async () => {
    const app = await build()
    const log = watchLog(app)
    await log.ready
    const r = await runTest(app.runtime('signer-client')!, { purpose: 'login', payload })
    if (!r.ok) throw new Error(r.fail.reason)
    expect(log.seen).toEqual([[`login: ${r.value.publicKey}`]])
  })

  test('swapping the vault at its home keeps every coord and subscription; the client sees a fresh vault through the placed signer', async () => {
    const app = await build()
    const log = watchLog(app)
    await log.ready
    const client = app.runtime('signer-client')!, signer = app.runtime('signer')!
    const before = await runTest(client, { purpose: 'login', payload })
    if (!before.ok) throw new Error(before.fail.reason)
    const oldKey = before.value.publicKey
    const events: RuntimeEvent[] = []
    signer.listen(e => events.push(e))
    const subscriptions = [signer.subscriptions(), client.subscriptions()]

    // Swapped where it lives; the client cannot swap what it only holds.
    expect(await client.swap('signer', 'example.signer/signer')).toMatchObject({ ok: false, fail: { type: 'denied' } })
    expect(await signer.swap('vault', 'example.signer/vault')).toEqual(success(undefined))

    // One event, and no subscription waited, broke or went away.
    expect(events).toEqual([{ type: 'pod-swapped', pod: 'vault', from: 'example.signer/vault', to: 'example.signer/vault' }])
    expect([signer.subscriptions(), client.subscriptions()]).toEqual(subscriptions)
    for (const rt of [signer, client]) for (const s of rt.subscriptions()) expect(rt.status(s.id)).toBe('live')
    // A fresh vault: the old key is gone, new ones work, and the log keeps listening.
    expect(await press(client, SIGNER, Signer, Signer.ops.sign, { publicKey: oldKey, purpose: 'login', payload }))
      .toEqual(success({ status: 'unknown-key' }))
    const after = await runTest(client, { purpose: 'login', payload })
    if (!after.ok) throw new Error(after.fail.reason)
    expect(after.value.result.status).toBe('signed')
    expect(log.seen[1]).toEqual([`login: ${oldKey}`, `login: ${after.value.publicKey}`])
  })

  test('the committed nano.json is what saving writes, and loading it gives a working signer', async () => {
    const doc = saveDoc(await build(), { title: 'External signer' })
    if (process.env.NANO_WRITE) await Bun.write(DOC, JSON.stringify(doc, null, 2) + '\n')
    const committed = await Bun.file(DOC).json()
    expect(committed).toEqual(doc)

    const { app, notes } = await loadDoc(committed, { registry: registry() })
    expect(notes).toEqual([])
    const r = await runTest(app.runtime('signer-client')!, { purpose: 'login', payload })
    if (!r.ok) throw new Error(r.fail.reason)
    const { publicKey, result } = r.value
    if (result.status !== 'signed') throw new Error(result.status)
    expect(await verify(publicKey, result.signature, payload)).toBe(true)
  })
})
