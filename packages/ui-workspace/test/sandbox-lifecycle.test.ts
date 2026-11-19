// The sandbox protocol over a MessageChannel, no iframe; see sandbox-harness.ts for the pods and the frame.
import { afterEach, expect, test } from 'bun:test'
import { checkMsg, describeProvider } from '../src/sandbox/protocol.ts'
import { st, acme, tick, reset, harness } from './sandbox-harness.ts'

afterEach(reset)

test('given app.close(), then the frame closes and the frame is disposed once', async () => {
  const { app, disposed } = await harness()
  await app.call('r', 's').echo!('x')
  await app.close()
  expect(st.frameClosed).toBe(1)
  expect(disposed()).toBe(1)
})

test('given a frame that never sends ready, then the call fails threw within 200ms', async () => {
  const { app, disposed } = await harness({ readyMs: 50, silent: true })
  const t0 = Date.now(), r = await app.call('r', 's').echo!('x')
  expect(r).toMatchObject({ ok: false, fail: { type: 'threw' } })
  expect(Date.now() - t0).toBeLessThan(200)
  expect(disposed()).toBe(1)
  await app.close()
})

test('given junk from the frame, then it fails the frame as failed does: a pending call settles threw with the reason', async () => {
  const bad = describeProvider(acme, {})
  expect(typeof checkMsg({ type: 'described', providers: [bad] })).toBe('object')
  ;(bad.implementations[0]!.provides[0]!.ops[0]!.input!.schema as Record<string, unknown>).pattern = '(a+)+$'
  const junk: [unknown, string][] = [[{ type: 'result', id: 999 }, 'bad result'], [{ type: 'nope' }, 'unknown type nope'],
    [{ type: 'publish', op: 'tick', data: 'x'.repeat(2 * 1024 * 1024) }, 'over 1 MiB'], [{ type: 'described', providers: [bad] }, 'pattern']]
  for (const [m, why] of junk) {
    const { app, frame } = await harness({ silent: true })
    const pending = app.call('r', 's').echo!('x')
    await tick(10)
    frame().postMessage({ type: 'ready' })
    await tick(10)   // built; the call is posted and the silent frame never answers
    frame().postMessage(m)
    const r = await pending
    expect(r).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(r.ok ? '' : r.fail.reason).toContain(why)
    expect(await app.call('r', 's').echo!('y')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    await app.close()
  }
})
