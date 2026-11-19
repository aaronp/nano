// The external signer, end to end, as one deployment (see signer-setup.ts and the header of nano.json's runtimes: signer, signer-client).
import { describe, expect, test } from 'bun:test'
import { DOC, runTest, probe, registry, open, build, watchLog, payload, verify } from './signer-setup.ts'

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
