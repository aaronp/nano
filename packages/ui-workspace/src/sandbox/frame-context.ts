/**
 * The frame's `NanoContext`: `one`/`all` match the edges the host pushed with nano's `matches`, a Selection's call
 * crosses the port as an `outcall`, `publish` posts `publish`, and `on` does not cross (a no-op and a `warn`).
 *
 *   const { ctx, close } = frameContext('s', ['r'], () => edges, post, (pod, runtime, op, input) => …)
 *   await close('closed')   // the close listeners, in the order added; a throwing one is skipped
 */
import {
  failure,
  matches,
  success,
  selectorData,
  type Client,
  type Interface,
  type NanoContext,
  type NanoResult,
  type Selection,
  type SelectorData,
} from '@pritzlaff/nano-core'
import type { Edge } from './edges.ts'
import type { Msg } from './protocol.ts'

type Out = (pod: string, runtime: string, op: string, input: unknown) => Promise<NanoResult<unknown>>
type OnClose = Parameters<NanoContext['addOnCloseListener']>[0]
type Reason = Parameters<OnClose>[0]['reason']

/** A client by op name; `then` is not an op, so awaiting a client is harmless. */
const client = <I extends Interface>(call: (op: string, input: unknown) => Promise<NanoResult<unknown>>) =>
  new Proxy({}, { get: (_, name) => (typeof name === 'string' && name !== 'then' ? (input: unknown) => call(name, input) : undefined) }) as Client<I>

export function frameContext(self: string, runtimes: string[], edges: () => Edge[], post: (m: Msg) => void, out: Out) {
  const listeners: OnClose[] = []
  const send = (m: Msg) => { try { post(m) } catch (e) { console.warn(`sandbox ${self}: not sent: ${e instanceof Error ? e.message : e}`) } }

  const selection = <I extends Interface>(e: Edge): Selection<I> => ({
    pod: e.pod, runtime: e.runtime, call: client<I>((op, input) => out(e.pod, e.runtime, op, input)),
    on: ((_op: unknown, fn?: unknown) => { send({ type: 'warn', reason: `${self}: on does not cross a sandbox` }); return fn ? () => {} : (async function* () {})() }) as never,
  })
  const all = <I extends Interface>(s: I | SelectorData): Selection<I>[] => {
    const want = selectorData(s)
    return edges().filter(e => matches(want, { name: e.pod, runtime: e.runtime, implementation: e.implementation, provider: e.provider,
      provides: new Set(e.provides), tags: new Set(e.tags) })).map(e => selection<I>(e))
  }

  const ctx: Omit<NanoContext, 'deps'> = {
    self, runtimes,
    one<I extends Interface>(s: I | SelectorData) {
      const found = all<I>(s), what = JSON.stringify(selectorData(s))
      if (found.length === 1) return success(found[0]!)
      return found.length ? failure('not-unique', `${self}: ${found.length} wired match ${what}`)
        : failure('not-found', `${self}: nothing wired matches ${what}`)
    },
    all,
    async publish(o, data) { send({ type: 'publish', op: o.name, data }) },
    addOnCloseListener(fn) { listeners.push(fn) },
  }
  async function close(reason: Reason) {
    for (const fn of listeners) try { await fn({ reason }) } catch (e) { console.warn(`sandbox ${self}: a close listener threw: ${e instanceof Error ? e.message : e}`) }
  }
  return { ctx, close }
}
