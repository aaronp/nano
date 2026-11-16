/**
 * Instances: at most one build per pod name, shared by everyone who needs it meanwhile. Each build has its own close
 * listeners. A failed build closes (`closed`) and caches nothing, so the next need builds again; forgetting drops the
 * entry and closes that build at once, even one still under way (a listener it adds later runs as it is added), without
 * waiting for or touching calls already handed it. A pod being closed is built again only once its close has settled,
 * and a build forgotten meanwhile never starts. `close` also waits for builds under way, which then build nothing.
 *
 *   const pods = instances(live)
 *   await pods.get('db')                 // NanoResult<{ implementation, handlers by port }>: built now, or the build already made or under way
 *   await pods.forget('db', 'restarted') // its listeners have run; the next get builds a fresh closure; calls in flight keep the old one
 *   await pods.close()                   // every build closed (`closed`); every later get is not-found
 */
import type { NanoContext } from '../context.ts'
import type { Implementation } from '../implementation.ts'
import type { Pod } from '../pod.ts'
import { failure, success, type NanoResult } from '../result.ts'
import { contextFor } from './context.ts'
import { attempt, within, type Live } from './messages.ts'

type Made = ReturnType<Live['instance']>
type OnClose = Parameters<NanoContext['addOnCloseListener']>[0]
type Reason = Parameters<OnClose>[0]['reason']

/**
 * One build's close listeners. `close` runs them once, in the order added, each within the timeout, a throw or a
 * timeout a `failure`; then `closed`. A listener added once closing has begun runs at once.
 */
function closer(live: Live, pod: string) {
  const listeners: OnClose[] = []
  let reason: Reason | undefined, closing: Promise<void> | undefined
  const run = (fn: OnClose) => attempt(live, pod, `closing ${pod}`, () => fn({ reason: reason! }))
  return {
    add(fn: OnClose) { if (reason) void run(fn); else listeners.push(fn) },
    began: () => reason !== undefined,
    close: (why: Reason) => closing ??= (async () => {
      reason = why
      for (const fn of listeners) await run(fn)
      live.trace.emit({ type: 'closed', pod, reason: why })
    })(),
  }
}

/** `pod`'s implementation: the registry's for a host pod, else `live.isolate`'s stand-in, which must keep its coord. */
async function implementationOf(live: Live, name: string, pod: Pod): Promise<NanoResult<Implementation> | undefined> {
  if ((pod.isolation ?? 'host') === 'host') { const i = live.registry.implementation(pod.implementation); return i && success(i) }
  const { isolate } = live
  if (!isolate) return failure('invalid-input', `no host for isolation ${pod.isolation}`)
  const r = await within(() => isolate(name, structuredClone(pod)), live.timeoutMs, `isolating ${name}`)
  if (!r.ok || r.value.coord === pod.implementation) return r
  return failure('invalid-input', `isolate gave ${r.value.coord} for ${pod.implementation}`)
}

export function instances(live: Live) {
  const made = new Map<string, { build: Made; close: (why: Reason) => Promise<void> }>()
  const closing = new Map<string, Promise<void>>()
  let closed = false

  async function build(name: string, c: ReturnType<typeof closer>): Made {
    await closing.get(name)
    if (c.began()) return failure('not-found', `${name} was closed before it was built`)
    const pod = live.now().pods[name]
    const found = pod && await implementationOf(live, name, pod)
    if (!pod || !found) return failure('not-found', `no pod ${name}`)
    if (!found.ok) { live.trace.emit({ type: 'failure', pod: name, reason: found.fail.reason }); await c.close('closed'); return found }
    const impl = found.value
    const r = await within(() => impl.make(contextFor(live, name, c.add), pod.config, reason => live.trace.emit({ type: 'failure', pod: name, reason })), live.timeoutMs, `building ${name}`)
    // Closed while `make` ran: its listeners have run as added; nothing is built after `closed`.
    if (closed) return failure('not-found', 'application is closed')
    live.trace.emit(r.ok ? { type: 'built', pod: name } : { type: 'failure', pod: name, reason: r.fail.reason })
    if (!r.ok) await c.close('closed')
    return r.ok ? success({ implementation: impl, handlers: r.value }) : r
  }

  async function forget(name: string, why: Reason) {
    const e = made.get(name)
    if (!e) return
    made.delete(name)
    // Chained: a build waits for every close of its name still settling, not only the latest.
    const p = Promise.all([closing.get(name), e.close(why)]).then(() => {})
    closing.set(name, p)
    await p
    if (closing.get(name) === p) closing.delete(name)
  }

  return {
    get(name: string): Made {
      if (closed) return Promise.resolve(failure('not-found', 'application is closed'))
      let e = made.get(name)
      if (!e) {
        const c = closer(live, name), mine = { build: build(name, c), close: c.close }
        made.set(name, (e = mine))
        void mine.build.then(r => { if (!r.ok && made.get(name) === mine) made.delete(name) })
      }
      return e.build
    },
    forget,
    async close() {
      closed = true
      const builds = [...made.values()].map(e => e.build)
      await Promise.all([...[...made.keys()].map(n => forget(n, 'closed')), ...builds])
    },
  }
}
