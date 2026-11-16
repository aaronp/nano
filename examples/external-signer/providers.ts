/**
 * The `example.signer` provider: a vault holding Ed25519 keys (WebCrypto, in memory), a generator and a signer in front
 * of it, a tester widget that uses both, a log, and a map that turns stored keys into log lines.
 *
 *   registry.add(signerProvider)
 *   { pods: { vault: Pod.lazy(vault), signer: Pod.lazy(signer) },
 *     runtimes: { signer: { pods: ['vault', 'signer'], subscriptions: [{ kind: 'call', from: 'signer', to: 'vault' }] } } }
 */
import { Implementation, provide, Provider, success } from '@pritzlaff/nano-core'
import { KeyFormatter, KeyGenerator, Log, Signer, Tester, Vault } from './interfaces.ts'

const toBase64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))
const fromBase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/** Makes and keeps Ed25519 keys in memory; private keys never leave it. A purpose other than the key's is `denied`. */
const vault = Implementation.define('example.signer/vault', {
  provides: [Vault],
  make: ctx => {
    const keys = new Map<string, { purpose: string; key: CryptoKey }>()
    return [provide(Vault, {
      async create({ count, purpose }) {
        const made = await Promise.all(Array.from({ length: count }, async () => {
          const k = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair
          const publicKey = toBase64(await crypto.subtle.exportKey('raw', k.publicKey))
          keys.set(publicKey, { purpose, key: k.privateKey })
          return publicKey
        }))
        await ctx.publish(Vault.ops.keys, made.map(publicKey => ({ publicKey, purpose })))
        return success({ keys: made })
      },
      async 'sign-with'({ publicKey, purpose, payload }) {
        const held = keys.get(publicKey)
        if (!held) return success({ status: 'unknown-key' as const })
        if (held.purpose !== purpose) return success({ status: 'denied' as const, reason: `this key is for ${held.purpose}` })
        const signature = await crypto.subtle.sign('Ed25519', held.key, fromBase64(payload))
        return success({ status: 'signed' as const, signature: toBase64(signature) })
      },
    })]
  },
})

/** What others are given to make keys: it asks the vault, which keeps the private halves. */
const generator = Implementation.define('example.signer/generator', {
  provides: [KeyGenerator],
  dependencies: { vault: Vault },
  make: ctx => [provide(KeyGenerator, {
    'create-keys': async request => ctx.one(Vault).call.create(request),
  })],
})

/** The signer others are given: it asks the vault, which never leaves the `signer` runtime. */
const signer = Implementation.define('example.signer/signer', {
  provides: [Signer],
  dependencies: { vault: Vault },
  make: ctx => [provide(Signer, {
    sign: async request => ctx.one(Vault).call['sign-with'](request),
  })],
})

const tester = Implementation.define('example.signer/tester', {
  provides: [Tester],
  dependencies: { signer: Signer, generator: KeyGenerator },
  make: ctx => [provide(Tester, {
    async test({ purpose, payload, signAs }) {
      const g = ctx.one(KeyGenerator), s = ctx.one(Signer)
      if (!s.ok) return { ok: false, fail: s.fail! }
      const made = await g.call['create-keys']({ count: 1, purpose })
      if (!made.ok) return made
      const publicKey = made.value.keys[0]!
      const signed = await s.call.sign({ publicKey, purpose: signAs ?? purpose, payload })
      return signed.ok ? success({ publicKey, result: signed.value }) : signed
    },
  })],
})

const log = Implementation.define('example.signer/log', {
  provides: [Log],
  make: ctx => {
    const entries: string[] = []
    return [provide(Log, {
      async append(line) {
        entries.push(line)
        await ctx.publish(Log.ops.entries, [...entries])
        return success(null)
      },
    })]
  },
})

const map = Implementation.define('example.signer/map', {
  provides: [KeyFormatter],
  make: ctx => [provide(KeyFormatter, {
    async format(keys) {
      for (const k of keys) await ctx.publish(KeyFormatter.ops.line, `${k.purpose}: ${k.publicKey}`)
      return success(null)
    },
  })],
})

export const signerProvider = Provider.define('example.signer', [vault, generator, signer, tester, log, map])
