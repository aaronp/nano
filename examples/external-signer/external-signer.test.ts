/**
 * The external signer, end to end: a `signer` runtime keeps the keys; the application places its `generator` and
 * `signer` into `signer-client`, where a tester uses them and a log shows the keys the vault stores.
 *
 *   signer:         vault ← generator, vault ← signer (provisioned), vault.keys → map.format
 *   signer-client:  tester → generator, tester → signer (provisioned), map.line → log.append   (map placed from signer)
 */
import { describe, expect, test } from 'bun:test'
import { Type, type Static } from 'typebox'
import {
  createApplication, createRegistry, defineSchema, iface, implementation, loadDoc, op, parseInstance, portKey, provide, provider, saveDoc, success,
  type Application, type Interface, type NanoResult, type Op, type Runtime,
} from '@pritzlaff/nano'
import { KeyFormatter, Log, Signer, Tester, TestRequest, TestResult, Vault } from './interfaces.ts'
import { signerProvider } from './providers.ts'

const VAULT = 'vault#0', GENERATOR = 'generator#0', SIGNER = 'signer#0'
const TESTER = 'tester#0', LOG = 'log#0', MAP = 'map#0'
const DOC = new URL('./nano.json', import.meta.url)

/** What a host does when a person presses a button: call one of an instance's ops from outside. */
const press = (rt: Runtime, coord: string, i: Interface, o: Op, input: unknown) => rt.record(parseInstance(coord)!.pod)!.instances.get(coord)!.host!.invoke(portKey(i.coord, o.coord), input)
const runTest = (rt: Runtime, input: Static<typeof TestRequest.schema>) =>
  press(rt, TESTER, Tester, Tester.ops.test, input) as Promise<NanoResult<Static<typeof TestResult.schema>>>

/** A sink that takes anything: subscribe a source to it to see what the source publishes. */
function probe() {
  const seen: unknown[] = []
  const Probe = iface('example.probe.Probe', { see: op.sink('see', defineSchema('Anything', Type.Unknown())) })
  const impl = implementation('example.probe/probe', { provides: [Probe], make: () => [provide(Probe, { see: async (_ctx, v) => { seen.push(v); return success(undefined) } })] })
  return { provider: provider('example.probe', [impl]), seen, port: portKey(Probe.coord, Probe.ops.see.coord) }
}

function registry() {
  const r = createRegistry()
  r.add(signerProvider)
  return r
}

async function build(): Promise<Application> {
  const app = createApplication('app', { registry: registry() })
  const signer = app.createRuntime('signer')
  const client = app.createRuntime('signer-client')
  if (!signer.ok || !client.ok) throw new Error('runtimes')

  await signer.value.create('vault', 'example.signer/vault')
  // Provisioning finds the one vault beside them and subscribes to it.
  await signer.value.create('generator', 'example.signer/generator', { provision: true })
  await signer.value.create('signer', 'example.signer/signer', { provision: true })
  await signer.value.create('map', 'example.signer/map')
  signer.value.subscribe({ kind: 'event', from: VAULT, source: portKey(Vault.coord, Vault.ops.keys.coord), to: MAP, target: portKey(KeyFormatter.coord, KeyFormatter.ops.format.coord) })

  app.place(GENERATOR, 'signer', 'signer-client')
  app.place(SIGNER, 'signer', 'signer-client')
  app.place(MAP, 'signer', 'signer-client')
  // Placed first, so provisioning finds the generator and signer in the client and subscribes the tester to them.
  await client.value.create('tester', 'example.signer/tester', { provision: true })
  await client.value.create('log', 'example.signer/log')
  client.value.subscribe({ kind: 'event', from: MAP, source: portKey(KeyFormatter.coord, KeyFormatter.ops.line.coord), to: LOG, target: portKey(Log.coord, Log.ops.append.coord) })
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
      client.subscribe({ kind: 'event', from: LOG, source: portKey(Log.coord, Log.ops.entries.coord), to: 'probe#0', target: p.port })),
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

  test('replacing the vault with a fresh one keeps every subscription live', async () => {
    const app = await build()
    const log = watchLog(app)
    await log.ready
    const client = app.runtime('signer-client')!, signer = app.runtime('signer')!
    const before = await runTest(client, { purpose: 'login', payload })
    if (!before.ok) throw new Error(before.fail.reason)
    const oldKey = before.value.publicKey

    expect(await signer.swap('vault', 'example.signer/vault')).toEqual(success(undefined))

    // signer: generator → vault, signer → vault, vault.keys → map; client: tester → signer, tester → generator, map → log, log → probe.
    expect(signer.subscriptions()).toHaveLength(3)
    expect(client.subscriptions()).toHaveLength(4)
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
