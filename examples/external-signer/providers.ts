/**
 * The `example.signer` provider: a vault holding Ed25519 keys (WebCrypto, in memory), a generator and a signer in front
 * of it, a tester widget that uses both, a log, and a map that turns stored keys into log lines.
 *
 *   registry.add(signerProvider)
 *   await rt.create('vault', 'example.signer/vault')
 *   await rt.create('signer', 'example.signer/signer', { provision: true })   // subscribes to the vault beside it
 */
import { implementation, provide, provider, success } from '@pritzlaff/nano'
import { KeyFormatter, KeyGenerator, Log, Signer, Tester, Vault } from './interfaces.ts'

const toBase64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))
const fromBase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/** Keys in memory, private ones never extractable again; a purpose other than the key's is `denied`. */
const vault = implementation('example.signer/vault', {
  provides: [Vault],
  make: () => {
    const keys = new Map<string, { purpose: string; key: CryptoKey }>()
    return [provide(Vault, {
      async store(ctx, { purpose, keys: pairs }) {
        for (const { publicKey, privateKey } of pairs)
          keys.set(publicKey, { purpose, key: await crypto.subtle.importKey('pkcs8', fromBase64(privateKey), { name: 'Ed25519' }, false, ['sign']) })
        await ctx.publish(Vault.ops.keys, pairs.map(p => ({ publicKey: p.publicKey, purpose })))
        return success({ stored: pairs.length })
      },
      async 'sign-with'(_ctx, { publicKey, purpose, payload }) {
        const held = keys.get(publicKey)
        if (!held) return success({ status: 'unknown-key' as const })
        if (held.purpose !== purpose) return success({ status: 'denied' as const, reason: `this key is for ${held.purpose}` })
        const signature = await crypto.subtle.sign('Ed25519', held.key, fromBase64(payload))
        return success({ status: 'signed' as const, signature: toBase64(signature) })
      },
    })]
  },
})

/** Makes key pairs and hands them to the vault; gives back only the public keys. */
const generator = implementation('example.signer/generator', {
  provides: [KeyGenerator],
  dependencies: { vault: Vault },
  make: () => [provide(KeyGenerator, {
    async 'create-keys'(ctx, { count, purpose }) {
      const pairs = await Promise.all(Array.from({ length: count }, async () => {
        const k = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
        return {
          publicKey: toBase64(await crypto.subtle.exportKey('raw', k.publicKey)),
          privateKey: toBase64(await crypto.subtle.exportKey('pkcs8', k.privateKey)),
        }
      }))
      const stored = await ctx.one(Vault, v => v.store({ purpose, keys: pairs }))
      return stored.ok ? success({ keys: pairs.map(p => p.publicKey) }) : stored
    },
  })],
})

/** The signer others are given: it asks the vault, which never leaves the `signer` runtime. */
const signer = implementation('example.signer/signer', {
  provides: [Signer],
  dependencies: { vault: Vault },
  make: () => [provide(Signer, {
    sign: (ctx, request) => ctx.one(Vault, v => v['sign-with'](request)),
  })],
})

const tester = implementation('example.signer/tester', {
  provides: [Tester],
  dependencies: { signer: Signer, generator: KeyGenerator },
  make: () => [provide(Tester, {
    async test(ctx, { purpose, payload, signAs }) {
      const made = await ctx.one(KeyGenerator, g => g['create-keys']({ count: 1, purpose }))
      if (!made.ok) return made
      const publicKey = made.value.keys[0]!
      const signed = await ctx.one(Signer, s => s.sign({ publicKey, purpose: signAs ?? purpose, payload }))
      return signed.ok ? success({ publicKey, result: signed.value }) : signed
    },
  })],
})

const log = implementation('example.signer/log', {
  provides: [Log],
  make: () => {
    const entries: string[] = []
    return [provide(Log, {
      async append(ctx, line) {
        entries.push(line)
        await ctx.publish(Log.ops.entries, [...entries])
        return success(undefined)
      },
    })]
  },
})

const map = implementation('example.signer/map', {
  provides: [KeyFormatter],
  make: () => [provide(KeyFormatter, {
    async format(ctx, keys) {
      for (const k of keys) await ctx.publish(KeyFormatter.ops.line, `${k.purpose}: ${k.publicKey}`)
      return success(undefined)
    },
  })],
})

export const signerProvider = provider('example.signer', [vault, generator, signer, tester, log, map])
