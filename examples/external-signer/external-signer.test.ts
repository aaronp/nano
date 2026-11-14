/**
 * The external signer, end to end: a `signer` runtime keeps the keys; the `generator`, `signer` and `map` pods are
 * registered in `signer-client` too, where a tester uses them and a log shows the keys the vault stores. The vault is
 * never registered in the client. Calls are provisioned (what a host does when a widget is added); events are
 * subscribed by a person, each end chosen with a selector, once. The vault is swapped where it lives; the client,
 * using it through the shared signer, sees it.
 *
 *   signer:         vault ← generator, vault ← signer (provisioned), vault.keys → map.format (subscribed)
 *   signer-client:  tester → generator, tester → signer (provisioned), map.line → log.append (subscribed)
 */
import { describe, expect, test } from 'bun:test'
import { Type, type Static } from 'typebox'
import {
  createApplication, createRegistry, defineSchema, iface, implementation, loadDoc, op, Pod, portKey, provide, provider, saveDoc, success,
  type Application, type Interface, type NanoResult, type Op, type Runtime, type RuntimeEvent,
} from '@pritzlaff/nano'
import { KeyFormatter, Log, TestRequest, TestResult, Vault } from './interfaces.ts'
import { signerProvider } from './providers.ts'

const DOC = new URL('./nano.json', import.meta.url)
const coord = (name: string) => `example.signer/${name}#0`
const [VAULT, GENERATOR, SIGNER, MAP, TESTER, LOG] = ['vault', 'generator', 'signer', 'map', 'tester', 'log'].map(coord) as [string, string, string, string, string, string]

/** The value, or a thrown error: setup steps that must work. */
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const port = (i: Interface, o: Op) => portKey(i.coord, o.coord)
/** A pod of one of the provider's implementations, registered in `rt`. */
const add = (rt: Runtime, name: string) => must(rt.register(Pod.create(signerProvider.implementations.get(`example.signer/${name}`)!)))
const provision = (rt: Runtime, c: string) => { const r = must(rt.provision(c)); if (r.length) throw new Error(JSON.stringify(r)) }

/** What a host does when a person presses a button: call the tester's op from outside. */
const runTest = (rt: Runtime, input: Static<typeof TestRequest.schema>) =>
  rt.call(TESTER).test(input) as Promise<NanoResult<Static<typeof TestResult.schema>>>

/** A sink that takes anything: subscribe a source to it to see what the source publishes. */
function probe() {
  const seen: unknown[] = []
  const Probe = iface('example.probe.Probe', { see: op.sink('see', defineSchema('Anything', Type.Unknown())) })
  const impl = implementation('example.probe/probe', { provides: [Probe], make: () => [provide(Probe, { see: async (_ctx, v) => { seen.push(v); return success(undefined) } })] })
  return { impl, provider: provider('example.probe', [impl]), seen, port: port(Probe, Probe.ops.see) }
}

function registry() {
  const r = createRegistry()
  r.add(signerProvider)
  return r
}

function build(r = registry()): Application {
  const app = createApplication('app', { registry: r })
  const signer = must(app.createRuntime('signer'))
  const client = must(app.createRuntime('signer-client'))

  add(signer, 'vault')
  // Provisioning finds the one vault beside them and subscribes to it.
  add(signer, 'generator'); provision(signer, GENERATOR)
  add(signer, 'signer'); provision(signer, SIGNER)
  add(signer, 'map')
  must(signer.subscribe({ kind: 'event', from: { coord: VAULT }, source: port(Vault, Vault.ops.keys), to: { coord: MAP }, target: port(KeyFormatter, KeyFormatter.ops.format) }))

  for (const c of [GENERATOR, SIGNER, MAP]) must(client.register(signer.pod(c)!))
  // Registered after them, so provisioning finds the generator and signer in the client and subscribes the tester to them.
  add(client, 'tester'); provision(client, TESTER)
  add(client, 'log')
  must(client.subscribe({ kind: 'event', from: { coord: MAP }, source: port(KeyFormatter, KeyFormatter.ops.line), to: { coord: LOG }, target: port(Log, Log.ops.append) }))
  return app
}

/** Subscribes a probe to the log's `entries` in `signer-client`; `seen` holds every list it publishes. */
function watchLog(p: ReturnType<typeof probe>, app: Application) {
  const client = app.runtime('signer-client')!
  const probeCoord = must(client.register(Pod.create(p.impl)))
  must(client.subscribe({ kind: 'event', from: { coord: LOG }, source: port(Log, Log.ops.entries), to: { coord: probeCoord }, target: p.port }))
  return { seen: p.seen }
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const payload = btoa('hello')

async function verify(publicKey: string, signature: string, data: string) {
  const key = await crypto.subtle.importKey('raw', fromBase64(publicKey), { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify('Ed25519', key, fromBase64(signature), fromBase64(data))
}

describe('the external signer', () => {
  test('the tester gets a key and a signature that verifies', async () => {
    const app = build()
    const r = await runTest(app.runtime('signer-client')!, { purpose: 'login', payload })
    if (!r.ok) throw new Error(r.fail.reason)
    const { publicKey, result } = r.value
    if (result.status !== 'signed') throw new Error(result.status)
    expect(await verify(publicKey, result.signature, payload)).toBe(true)
  })

  test('signing for another purpose is denied, as a value', async () => {
    const app = build()
    const r = await runTest(app.runtime('signer-client')!, { purpose: 'login', payload, signAs: 'payments' })
    expect(r).toMatchObject({ ok: true, value: { result: { status: 'denied' } } })
  })

  test('the keys the vault stores reach the log in the client, through the map', async () => {
    const p = probe(), reg = registry()
    reg.add(p.provider)
    const app = build(reg), log = watchLog(p, app)
    const r = await runTest(app.runtime('signer-client')!, { purpose: 'login', payload })
    if (!r.ok) throw new Error(r.fail.reason)
    expect(log.seen).toEqual([[`login: ${r.value.publicKey}`]])
  })

  test('swapping the vault at its home keeps every coord and subscription; the client sees a fresh vault through the shared signer', async () => {
    const p = probe(), reg = registry()
    reg.add(p.provider)
    const app = build(reg), log = watchLog(p, app)
    const client = app.runtime('signer-client')!, signer = app.runtime('signer')!
    const before = await runTest(client, { purpose: 'login', payload })
    if (!before.ok) throw new Error(before.fail.reason)
    const oldKey = before.value.publicKey
    const events: RuntimeEvent[] = []
    signer.listen(e => events.push(e))
    const subscriptions = [signer.subscriptions(), client.subscriptions()]

    // The vault is only ever registered in `signer`; swapping its pod is swapping it there.
    expect(await signer.pod(VAULT)!.swap()).toEqual(success(undefined))

    // One event, and no subscription waited, broke or went away.
    expect(events).toEqual([{ type: 'pod-swapped', coord: VAULT }])
    expect([signer.subscriptions(), client.subscriptions()]).toEqual(subscriptions)
    for (const rt of [signer, client]) for (const s of rt.subscriptions()) expect(rt.status(s.id)).toBe('live')
    // A fresh vault: the old key is gone, new ones work, and the log keeps listening.
    expect(await client.call(SIGNER).sign({ publicKey: oldKey, purpose: 'login', payload }))
      .toEqual(success({ status: 'unknown-key' }))
    const after = await runTest(client, { purpose: 'login', payload })
    if (!after.ok) throw new Error(after.fail.reason)
    expect(after.value.result.status).toBe('signed')
    expect(log.seen[1]).toEqual([`login: ${oldKey}`, `login: ${after.value.publicKey}`])
  })

  test('the committed nano.json is what saving writes, and loading it gives a working signer', async () => {
    const doc = saveDoc(build(), { title: 'External signer' })
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
