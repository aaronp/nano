// Shared setup of the external-signer tests: the SIGNER deployment, a probe pod and helpers to open it and verify a signature.
import { Type, type Static } from 'typebox'
import { Application, AppDeployment, Coord, Registry, Schema, Implementation, Op, Pod, port, provide, success, type Application as App, type NanoResult } from '@pritzlaff/nano-core'
import { KeyFormatter, Log, TestRequest, TestResult, Vault } from './interfaces.ts'
import { signerProvider } from './providers.ts'

export const ns = Coord.namespace('example.probe')

export const DOC = new URL('./nano.json', import.meta.url)

/** The value, or a thrown error: setup steps that must work. */
export const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
export const pod = (name: string) => Pod.lazy(signerProvider.implementations.get(`example.signer/${name}`)!)

export const SIGNER: AppDeployment = {
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
export const runTest = (app: App, input: Static<typeof TestRequest>) =>
  app.call('signer-client', 'tester').test(input) as Promise<NanoResult<Static<typeof TestResult>>>

/** An action that takes anything: subscribe an event to it to see what is published. */
export function probe() {
  const seen: unknown[] = []
  const Probe = ns.interface('Probe', { see: Op.action(Schema.define(Type.Unknown(), 'Anything'), Schema.define(Type.Null(), 'Done')) })
  const impl = Implementation.define(ns.implementationId('probe'), { provides: [Probe], make: () => [provide(Probe, { see: async v => { seen.push(v); return success(null) } })] })
  return { impl, provider: ns.provider([impl]), seen, port: port(Probe, Probe.ops.see) }
}

export const registry = () => { const r = Registry.create(); r.add(signerProvider); return r }

/** `d` assembled with `r` and made live. */
export const open = async (d: unknown, r = registry()) => must(await Application.create(must(AppDeployment.assemble(d, r)), {}))
export const build = (r = registry()) => open(SIGNER, r)

/** Applies a probe in `signer-client` subscribed to the log's `entries`; `seen` holds every list it publishes. */
export async function watchLog(p: ReturnType<typeof probe>, app: App) {
  const d = app.deployment(), client = d.runtimes['signer-client']!
  must(await app.apply({
    ...d,
    pods: { ...d.pods, probe: Pod.lazy(p.impl) },
    runtimes: { ...d.runtimes, 'signer-client': { ...client, pods: [...client.pods, 'probe'], subscriptions: [...client.subscriptions,
      { kind: 'pipe', from: 'log', source: port(Log, Log.ops.entries), to: 'probe', target: p.port }] } },
  }))
  return { seen: p.seen }
}

export const fromBase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
export const payload = btoa('hello')

export async function verify(publicKey: string, signature: string, data: string) {
  const key = await crypto.subtle.importKey('raw', fromBase64(publicKey), { name: 'Ed25519' }, false, ['verify'])
  return crypto.subtle.verify('Ed25519', key, fromBase64(signature), fromBase64(data))
}
