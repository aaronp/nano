/**
 * The time machine: reset an app to a recorded deployment and re-send the recording's roots at their original pace,
 * then say where the new run differs from the old.
 *
 *   await replay(app, store)                                          // success({ sent: 3 })
 *   diverge(pair(await first.range()), pair(await second.range()))   // null: the same messages came out
 */
import { failure, success, type AppDeployment, type Application, type NanoResult } from '@pritzlaff/nano-core'
import { pair, truncated, type Message, type MessageStore } from './entry.ts'

/** The messages nothing in the app caused: host calls with no cause. */
export const roots = (messages: Message[]): Message[] =>
  messages.filter(m => m.sent.from === 'host' && m.sent.kind === 'call' && m.sent.cause === undefined)

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Resets `app` to the deployment in force at `from` and re-sends the roots in [from, to] at their recorded offsets. */
export async function replay(app: Application, store: MessageStore, opts: { from?: number; to?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<NanoResult<{ sent: number }>> {
  await store.flush()
  const oldest = await store.oldest()
  const from = opts.from ?? oldest
  const start = oldest === undefined || from === undefined || oldest > from ? undefined
    : (await store.range(oldest, from)).findLast(e => e.event.type === 'deployment')
  if (!start || start.event.type !== 'deployment') return failure('not-found', 'the recording no longer holds the start of that range')
  const deployment: AppDeployment = start.event.deployment
  const sends = roots(pair(await store.range(from, opts.to)))
  const cut = sends.find(m => m.sent.input !== undefined && truncated(m.sent.input))
  if (cut) return failure('invalid-input', `message ${cut.seq}: its input was truncated when recorded`)

  const applied = await app.apply(deployment)
  if (!applied.ok) return applied
  for (const pod of Object.keys(deployment.pods)) { const r = await app.restart(pod); if (!r.ok) return r }

  const sleep = opts.sleep ?? wait
  const began = Date.now()
  for (const { at, sent } of sends) {
    const due = at - sends[0]!.at - (Date.now() - began)
    if (due > 0) await sleep(due)
    const input = sent.input === undefined || sent.input === 'undefined' ? undefined : JSON.parse(sent.input)
    const op = sent.port.slice(sent.port.lastIndexOf('/') + 1)
    await app.runtime(sent.runtime).call(sent.to)[op]!(input)
  }
  return success({ sent: sends.length })
}

const same = (m: Message) => JSON.stringify([m.sent.kind, m.sent.from, m.sent.to, m.sent.port, m.sent.input,
  m.outcome?.type, m.outcome?.type === 'delivered' ? [m.outcome.ok, m.outcome.result] : undefined])

/** The first message that differs between two runs (kind, from, to, port, input, outcome ok and result; ids, times and causes ignored), or null. */
export function diverge(recorded: Message[], replayed: Message[]): { index: number; recorded?: Message; replayed?: Message } | null {
  const msgs = (ms: Message[]) => ms.filter(m => m.sent.kind !== 'subscribe' && m.sent.kind !== 'unsubscribe')
  const a = msgs(recorded), b = msgs(replayed)
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (!a[i] || !b[i] || same(a[i]!) !== same(b[i]!)) return { index: i, recorded: a[i], replayed: b[i] }
  return null
}
