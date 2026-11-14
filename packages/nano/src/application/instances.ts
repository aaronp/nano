/**
 * Instances: at most one build per pod name, shared by everyone who needs it meanwhile. Each build has its own close
 * listeners. A failed build closes (`closed`) and caches nothing, so the next need builds again; forgetting drops the
 * entry and closes that build at once, even one still under way (a listener it adds later runs as it is added), without
 * waiting for or touching calls already handed it. A pod being closed is built again only once its close has settled.
 *
 *   const pods = instances(live)
 *   await pods.get('db')                 // NanoResult<{ implementation, handlers by port }>: built now, or the build already made or under way
 *   await pods.forget('db', 'restarted') // its listeners have run; the next get builds a fresh closure; calls in flight keep the old one
 *   await pods.close()                   // every build closed (`closed`); every later get is not-found
 */
import type { NanoContext } from '../context.ts'
import { failure, success } from '../result.ts'
import { contextFor } from './context.ts'
import { within, type Live } from './messages.ts'

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
  const run = async (fn: OnClose) => {
    const r = await within(() => fn({ reason: reason! }), live.timeoutMs, `closing ${pod}`)
    if (!r.ok) live.trace.emit({ type: 'failure', pod, reason: r.fail.reason })
  }
  return {
    add(fn: OnClose) { if (reason) void run(fn); else listeners.push(fn) },
    close: (why: Reason) => closing ??= (async () => {
      reason = why
      for (const fn of listeners) await run(fn)
      live.trace.emit({ type: 'closed', pod, reason: why })
    })(),
  }
}

export function instances(live: Live) {
  const made = new Map<string, { build: Made; close: (why: Reason) => Promise<void> }>()
  const closing = new Map<string, Promise<void>>()
  let closed = false

  async function build(name: string, c: ReturnType<typeof closer>): Made {
    await closing.get(name)
    const pod = live.now().pods[name]
    const impl = pod && live.registry.implementation(pod.implementation)
    if (!pod || !impl) return failure('not-found', `no pod ${name}`)
    const r = await within(() => impl.make(contextFor(live, name, c.add), pod.config), live.timeoutMs, `building ${name}`)
    live.trace.emit(r.ok ? { type: 'built', pod: name } : { type: 'failure', pod: name, reason: r.fail.reason })
    if (!r.ok) await c.close('closed')
    return r.ok ? success({ implementation: impl, handlers: r.value }) : r
  }

  async function forget(name: string, why: Reason) {
    const e = made.get(name)
    if (!e) return
    made.delete(name)
    const p = e.close(why)
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
      await Promise.all([...made.keys()].map(n => forget(n, 'closed')))
    },
  }
}
