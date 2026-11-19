// The external signer, end to end, as one deployment (see signer-setup.ts and the header of nano.json's runtimes: signer, signer-client).
import { describe, expect, test } from 'bun:test'
import { port, success, type AppEvent } from '@pritzlaff/nano-core'
import { KeyGenerator, Signer, Tester, Vault } from './interfaces.ts'
import { observeCalls } from '../../packages/ui-workspace/src/observed-calls.ts'
import { must, pod, runTest, probe, registry, build, watchLog, payload } from './signer-setup.ts'

describe('the external signer', () => {
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

  test('sign is caused by the tester\'s test, sign-with by sign; every call in the flow is declared', async () => {
    const reg = registry(), app = await build(reg), o = observeCalls(app, reg), sent: Extract<AppEvent, { type: 'sent' }>[] = []
    app.listen(e => { if (e.type === 'sent') sent.push(e) })
    must(await runTest(app, { purpose: 'login', payload }))
    const at = (p: string) => sent.find(e => e.port === p)!
    expect(at(port(Signer, Signer.ops.sign)).cause).toBe(at(port(Tester, Tester.ops.test)).id)
    expect(at(port(Vault, Vault.ops['sign-with'])).cause).toBe(at(port(Signer, Signer.ops.sign)).id)
    expect(at(port(Vault, Vault.ops.create)).cause).toBe(at(port(KeyGenerator, KeyGenerator.ops['create-keys'])).id)
    const made = o.calls().filter(c => c.seen && c.source !== null)
    expect(made.length).toBe(4)
    expect(made.filter(c => !c.declared)).toEqual([])
  })
})
