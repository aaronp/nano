/**
 * The external signer, end to end, as one deployment: a `signer` runtime keeps the keys; the `generator`, `signer`
 * and `map` pods are placed in `signer-client` too, where a tester uses them and a log shows the keys the vault
 * stores. The vault is never placed in the client. Restarting the vault where it lives gives a fresh vault; the
 * client, using it through the shared signer, sees it.
 *
 *   signer:         generator → vault, signer → vault, vault.keys → map.format
 *   signer-client:  tester → signer, tester → generator, map.line → log.append
 */
import { describe, expect, test } from 'bun:test'
import { Type, type Static } from 'typebox'
import {
  Application, assemble, createRegistry, defineSchema, iface, implementation, op, Pod, port, provide, provider, success,
  type AppEvent, type Application as App, type AppDeployment, type NanoResult,
} from '@pritzlaff/nano'
import { KeyFormatter, Log, TestRequest, TestResult, Vault } from './interfaces.ts'
import { signerProvider } from './providers.ts'

const DOC = new URL('./nano.json', import.meta.url)

/** The value, or a thrown error: setup steps that must work. */
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const pod = (name: string) => Pod.lazy(signerProvider.implementations.get(`example.signer/${name}`)!)

const SIGNER: AppDeployment = {
  pods: { vault: pod('vault'), generator: pod('generator'), signer: pod('signer'), map: pod('map'), tester: pod('tester'), log: pod('log') },
  runtimes: {
    signer: {
      pods: ['vault', 'generator', 'signer', 'map'],
      subscriptions: [
        { kind: 'call', from: 'generator', to: 'vault' },
        { kind: 'call', from: 'signer', to: 'vault' },
        { kind: 'pipe', from: 'vault', source: port(Vault, Vault.ops.keys), to: 'map', target: port(KeyFormatter, KeyFormatter.ops.format) },
      ],
    },
    'signer-client': {
      pods: ['generator', 'signer', 'map', 'tester', 'log'],
      subscriptions: [
        { kind: 'call', from: 'tester', to: 'signer' },
        { kind: 'call', from: 'tester', to: 'generator' },
        { kind: 'pipe', from: 'map', source: port(KeyFormatter, KeyFormatter.ops.line), to: 'log', target: port(Log, Log.ops.append) },
      ],
    },
  },
}

/** What a host does when a person presses a button: call the tester's op from outside. */
const runTest = (app: App, input: Static<typeof TestRequest.schema>) =>
  app.call('signer-client', 'tester').test(input) as Promise<NanoResult<Static<typeof TestResult.schema>>>

/** An action that takes anything: subscribe an event to it to see what is published. */
function probe() {
  const seen: unknown[] = []
  const Probe = iface('example.probe.Probe', { see: op.action('see', defineSchema('Anything', Type.Unknown()), defineSchema('Done', Type.Null())) })
  const impl = implementation('example.probe/probe', { provides: [Probe], make: () => [provide(Probe, { see: async v => { seen.push(v); return success(null) } })] })
  return { impl, provider: provider('example.probe', [impl]), seen, port: port(Probe, Probe.ops.see) }
}

const registry = () => { const r = createRegistry(); r.add(signerProvider); return r }

/** `d` assembled with `r` and made live. */
const open = async (d: unknown, r = registry()) => must(await Application.create(must(assemble(d, r)), {}))
const build = (r = registry()) => open(SIGNER, r)

/** Applies a probe in `signer-client` subscribed to the log's `entries`; `seen` holds every list it publishes. */
async function watchLog(p: ReturnType<typeof probe>, app: App) {
  const d = app.deployment(), client = d.runtimes['signer-client']!
  must(await app.apply({
    ...d,
    pods: { ...d.pods, probe: Pod.lazy(p.impl) },
    runtimes: { ...d.runtimes, 'signer-client': { ...client, pods: [...client.pods, 'probe'], subscriptions: [...client.subscriptions,
      { kind: 'pipe', from: 'log', source: port(Log, Log.ops.entries), to: 'probe', target: p.port }] } },
  }))
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
    const r = await runTest(await build(), { purpose: 'login', payload })
    if (!r.ok) throw new Error(r.fail.reason)
    const { publicKey, result } = r.value
    if (result.status !== 'signed') throw new Error(result.status)
    expect(await verify(publicKey, result.signature, payload)).toBe(true)
  })

  test('signing for another purpose is denied, as a value', async () => {
    const r = await runTest(await build(), { purpose: 'login', payload, signAs: 'payments' })
    expect(r).toMatchObject({ ok: true, value: { result: { status: 'denied' } } })
  })

  test('the vault is never placed in the client: a host call to it there is not-found', async () => {
    const app = await build()
    expect(await app.call('signer-client', 'vault').create({ count: 1, purpose: 'login' })).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('signer', 'vault').create({ count: 1, purpose: 'login' })).toMatchObject({ ok: true })
  })

  test('the keys the vault stores reach the log in the client, through the map', async () => {
    const p = probe(), reg = registry(); reg.add(p.provider)
    const app = await build(reg), log = await watchLog(p, app)
    const r = await runTest(app, { purpose: 'login', payload })
    if (!r.ok) throw new Error(r.fail.reason)
    expect(log.seen).toEqual([[`login: ${r.value.publicKey}`]])
  })

  test('restarting the vault keeps every pod and subscription; the client sees a fresh vault through the shared signer', async () => {
    const p = probe(), reg = registry(); reg.add(p.provider)
    const app = await build(reg), log = await watchLog(p, app)
    const before = await runTest(app, { purpose: 'login', payload })
    if (!before.ok) throw new Error(before.fail.reason)
    const oldKey = before.value.publicKey
    const events: AppEvent[] = []
    app.listen(e => events.push(e))
    const deployment = app.deployment()

    // The vault is only ever placed in `signer`; restarting its pod forgets its instance there.
    expect(await app.restart('vault')).toEqual(success(undefined))

    // One event, and the deployment (every pod and subscription) is unchanged.
    expect(events).toEqual([{ type: 'closed', pod: 'vault', reason: 'restarted' }, { type: 'restarted', pod: 'vault' }])
    expect(app.deployment()).toEqual(deployment)
    // A fresh vault: the old key is gone, new ones work, and the log keeps listening.
    expect(await app.call('signer-client', 'signer').sign({ publicKey: oldKey, purpose: 'login', payload }))
      .toEqual(success({ status: 'unknown-key' }))
    const after = await runTest(app, { purpose: 'login', payload })
    if (!after.ok) throw new Error(after.fail.reason)
    expect(after.value.result.status).toBe('signed')
    expect(log.seen[1]).toEqual([`login: ${oldKey}`, `login: ${after.value.publicKey}`])
  })

  test('the committed nano.json is what saving writes, and it creates a working signer', async () => {
    const saved = (await build()).deployment()
    if (process.env.NANO_WRITE) await Bun.write(DOC, JSON.stringify(saved, null, 2) + '\n')
    const committed = await Bun.file(DOC).json()
    expect(committed).toEqual(saved)

    const r = await runTest(await open(committed), { purpose: 'login', payload })
    if (!r.ok) throw new Error(r.fail.reason)
    const { publicKey, result } = r.value
    if (result.status !== 'signed') throw new Error(result.status)
    expect(await verify(publicKey, result.signature, payload)).toBe(true)
  })
})
