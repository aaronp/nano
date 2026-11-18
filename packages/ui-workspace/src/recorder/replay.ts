/**
 * The time machine: reset an app to the recording's clean start and re-send every host input after it at its original
 * pace, then say where the new run differs from the old.
 *
 *   const r = await replay(app, store)                                 // success({ sent: 3, failed: 0, …, from: 1, to: 40 })
 *   diverge(pair(await store.range(r.from, r.to)), pair(await second.range()))   // null: the same messages came out
 */
import { failure, success, type Application, type NanoResult } from '@pritzlaff/nano-core'
import { pair, truncated, type Message, type MessageStore } from './entry.ts'

/**
 * The messages nothing in the app caused: host calls with no cause. Their inputs are snapshots, so a Map, Set, Date or
 * BigInt comes back as its JSON text and an undefined field is gone.
 */
export const roots = (messages: Message[]): Message[] =>
  messages.filter(m => m.sent.from === 'host' && m.sent.kind === 'call' && m.sent.cause === undefined)

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
/** How long one wait for quiet may take: core's default call timeout plus 1 s. ponytail: fixed, as the app doesn't say its `timeoutMs`; read it if it ever does. */
const QUIET_MS = 31_000

/**
 * Counts `app`'s messages in flight: each `sent` heard until its `delivered` or `denied` (an outcome of a message sent
 * before it listened is ignored: nothing waits on it). `quiet()` resolves once none is, one macrotask later and still
 * none (true), or after `QUIET_MS` from that call (false). `stop()` stops listening.
 */
function inFlight(app: Application) {
  const open = new Set<string>()
  let wake = () => {}
  const stop = app.listen(e => {
    if (e.type === 'sent') open.add(e.id)
    else if ((e.type === 'delivered' || e.type === 'denied') && open.delete(e.id) && !open.size) wake()
  })
  const quiet = async () => {
    const end = Date.now() + QUIET_MS
    for (;;) {
      while (open.size) {
        if (Date.now() >= end) return false
        let timer: ReturnType<typeof setTimeout> | undefined
        await new Promise<void>(r => { wake = r; timer = setTimeout(r, end - Date.now()) })
        clearTimeout(timer)
      }
      await wait(0)
      if (!open.size) return true
    }
  }
  return { quiet, stop }
}

type Replayed = { sent: number; failed: number; applied: number; restarted: number; from: number; to: number }
type Opts = { to?: number; now?: () => number; sleep?: (ms: number) => Promise<void>; pace?: 'original' | 'fast' }

/**
 * Rebuilds the app's state as of `to` (default: the newest entry). It starts from the store's oldest entry, which must
 * be a clean start, applies its deployment and restarts every pod (calls in flight finish on the old instances). Then
 * every host input recorded after it, up to `to`, happens again at its offset from the start, measured from the reset:
 * each root is re-sent (reads too), each later deployment is applied and each `restarted` pod is restarted. Roots are
 * not awaited one by one: an input waits only for the roots whose outcome was recorded before it, as the host did.
 * Returns the counts and the seq range covered; a re-sent root that fails counts in `failed`.
 * `pace: 'fast'` (for an app on a simulated clock) doesn't keep to the offsets: after the reset, before each input and
 * before it returns, it waits until no message is in flight; an input whose wait for quiet runs out counts in `failed`.
 */
export async function replay(app: Application, store: MessageStore, opts: Opts = {}): Promise<NanoResult<Replayed>> {
  await store.flush()
  const [start] = await store.range(undefined, undefined, 1)
  if (start?.event.type !== 'deployment' || !start.event.clean) return failure('not-found', 'the recording no longer holds a clean start')
  const entries = await store.range(start.seq, opts.to)
  if (!entries.length) return failure('not-found', `the recording starts after ${opts.to}`)
  const sends = new Map(roots(pair(entries)).map(m => [m.seq, m]))
  const cut = [...sends.values()].find(m => m.sent.input !== undefined && truncated(m.sent.input))
  if (cut) return failure('invalid-input', `message ${cut.seq}: its input was truncated when recorded`)
  const inputs = entries.filter(e => sends.has(e.seq) || e.event.type === 'restarted' || (e.event.type === 'deployment' && e !== start))

  const flight = opts.pace === 'fast' ? inFlight(app) : undefined   // before the reset, so the first input waits for its traffic too
  try {
    const reset = await app.apply(start.event.deployment)
    if (!reset.ok) return reset
    for (const pod of Object.keys(start.event.deployment.pods)) { const r = await app.restart(pod); if (!r.ok) return r }

    const now = opts.now ?? Date.now, sleep = opts.sleep ?? wait, began = now()
    const n = { sent: 0, failed: 0, applied: 0, restarted: 0, from: start.seq, to: entries.at(-1)!.seq }
    const settled = new Map(entries.flatMap(e => e.event.type === 'delivered' || e.event.type === 'denied' ? [[e.event.id, e.seq]] : []))
    const calls: { settled: number; done: Promise<void> }[] = []
    for (const { seq, at, event } of inputs) {
      if (flight) { if (!(await flight.quiet())) n.failed++ }
      else await sleep(Math.max(at - start.at - (now() - began), 0))   // at least a macrotask: the host's pipes landed
      await Promise.all(calls.filter(c => c.settled < seq).map(c => c.done))   // what the host waited for, it waits for again
      if (event.type === 'deployment' || event.type === 'restarted') {
        const r = event.type === 'deployment' ? await app.apply(event.deployment) : await app.restart(event.pod)
        if (!r.ok) { await Promise.all(calls.map(c => c.done)); return r }
        n[event.type === 'deployment' ? 'applied' : 'restarted']++
        continue
      }
      const { sent } = sends.get(seq)!
      const input = sent.input === undefined || sent.input === 'undefined' ? undefined : JSON.parse(sent.input)
      const op = sent.port.slice(sent.port.lastIndexOf('/') + 1)
      n.sent++
      const done = Promise.resolve().then(() => app.runtime(sent.runtime).call(sent.to)[op]!(input))
        .then(r => { if (!r.ok) n.failed++ }, () => { n.failed++ })
      calls.push({ settled: settled.get(sent.id) ?? Infinity, done })
    }
    await Promise.all(calls.map(c => c.done))
    if (flight && !(await flight.quiet())) n.failed++
    return success(n)
  } finally { flight?.stop() }
}

const same = (m: Message) => JSON.stringify([m.sent.kind, m.sent.from, m.sent.to, m.sent.port, m.sent.input,
  m.outcome?.type, m.outcome?.type === 'delivered' ? [m.outcome.ok, m.outcome.result] : undefined])

/**
 * The first message that differs between two runs (kind, from, to, port, input, outcome ok and result; ids, times and
 * causes ignored), or null. Pass the recording's replayed range, `store.range(r.from, r.to)`, not the whole store.
 * The replay also holds what restarted pods sent while building (a recording begun after startup lacks it): compare from the first host input.
 */
export function diverge(recorded: Message[], replayed: Message[]): { index: number; recorded?: Message; replayed?: Message } | null {
  const msgs = (ms: Message[]) => ms.filter(m => m.sent.kind !== 'subscribe' && m.sent.kind !== 'unsubscribe')
  const a = msgs(recorded), b = msgs(replayed)
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (!a[i] || !b[i] || same(a[i]!) !== same(b[i]!)) return { index: i, recorded: a[i], replayed: b[i] }
  return null
}
