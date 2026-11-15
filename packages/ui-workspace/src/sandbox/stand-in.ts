/**
 * The host's side of a sandboxed pod: an implementation with the real one's coord, interfaces, dependencies and
 * config, whose `make` opens a frame and whose handlers cross its port. The frame's outcalls go through the pod's own
 * context (so its own call edges, policed and on the stream), its publishes through `ctx.publish`.
 *
 *   isolate: (name, pod) => standIn(registry.implementation(pod.implementation)!, { url, open, edges, onApplied, warn, app })
 */
import { failure, port, type AppEvent, type Application, type Handler, type Implementation, type NanoResult } from '@pritzlaff/nano-core'
import type { Edge } from './edges.ts'
import { checkMsg, type Msg } from './protocol.ts'

export const READY_MS = 10_000

/** A way to the frame: its port, the opener's signal (rejects on a load error), and how to let go of it. */
export type Frame = { port: MessagePort; ready: Promise<void>; dispose(): void; element?: HTMLIFrameElement }

type Deps = {
  url: string
  open(pod: string): Frame
  edges(pod: string): Edge[]
  onApplied(fn: () => void): () => void
  warn(reason: string): void
  /** The application, for the frame's view: its `view-call`s and the stream events naming its pod. */
  app(): Application
  readyMs?: number
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
type Calls = Record<string, ((input: unknown) => Promise<NanoResult<unknown>>) | undefined>

/** Whether `e` names `pod`, keeping the ids of its `sent` so their `delivered`/`denied` count too. */
function naming(pod: string) {
  const ids = new Set<string>()   // ponytail: an id whose call never settles stays; nano settles every sent
  return (e: AppEvent) => e.type === 'sent' ? (e.from === pod || e.to === pod) && !!ids.add(e.id)
    : e.type === 'delivered' || e.type === 'denied' ? ids.delete(e.id)
    : e.type === 'applied' ? [...e.added, ...e.removed, ...e.changed, ...e.rewired].includes(pod)
    : 'pod' in e && e.pod === pod
}

/** `p` settled within `ms`; else rejects with `why`. */
function bounded<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(why)), ms) })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

export function standIn(real: Implementation, deps: Deps): Implementation {
  const ms = deps.readyMs ?? READY_MS
  const events = real.provides.flatMap(i => Object.values(i.ops).filter(o => o.kind === 'event'))
  return {
    coord: real.coord, provider: real.provider, provides: real.provides, dependencies: real.dependencies,
    ...(real.config && { config: real.config }), ...(real.description !== undefined && { description: real.description }),
    async make(ctx, config) {
      const self = ctx.self, frame = deps.open(self), pending = new Map<number, (r: NanoResult<unknown>) => void>()
      let failed: string | undefined, n = 0, closed = () => {}, ready = () => {}, abort = (_: Error) => {}
      const gate = new Promise<void>((res, rej) => { ready = res; abort = rej })
      gate.catch(() => {})
      const post = (m: Msg) => frame.port.postMessage(m)
      const drop = (why: string) => console.warn(`sandbox ${self}: dropped message: ${why}`)
      const fail = (why: string) => {
        failed ??= `${self}: ${why}`
        for (const res of pending.values()) res(failure('threw', failed))
        pending.clear()
        abort(new Error(failed))
      }
      const answer = (type: 'outresult' | 'view-result', id: number, r: NanoResult<unknown>) => {
        try { post({ type, id, result: r }) } catch (e) { try { post({ type, id, result: failure('invalid-output', message(e)) }) } catch { /* port gone */ } }
      }

      frame.port.onmessage = ({ data }) => {
        const m = checkMsg(data)
        if (typeof m === 'string') return fail(`a malformed message: ${m}`)   // untrusted: fails the frame as `failed` does
        switch (m.type) {
          case 'ready': return ready()
          case 'failed': return fail(m.error)
          case 'closed': return closed()
          case 'warn': return deps.warn(m.reason)
          case 'result': {
            const res = pending.get(m.id)
            if (!res) return drop(`result for no call ${m.id}`)
            pending.delete(m.id)
            return res(m.result)
          }
          case 'publish': {
            const o = events.find(o => o.name === m.op)
            if (!o) return drop(`${m.op} is not an event of ${real.coord}`)
            return void ctx.publish(o, m.data)
          }
          case 'view-call': {
            const f = (deps.app().call(ctx.runtimes[0]!, self) as Calls)[m.op]
            const r = f ? Promise.resolve().then(() => f(m.input)) : Promise.resolve(failure('unknown-op', `${self} has no op ${m.op}`))
            return void r.then(x => answer('view-result', m.id, x), e => answer('view-result', m.id, failure('threw', message(e))))
          }
          case 'outcall': {
            if (failed) return
            const sel = ctx.all({}).find(s => s.pod === m.pod && s.runtime === m.runtime)
            const f = sel && (sel.call as Calls)[m.op]
            const r = f ? Promise.resolve().then(() => f(m.input)) : Promise.resolve(failure('not-found', `${self}->${m.pod} is not in ${m.runtime}`))
            return void r.then(x => answer('outresult', m.id, x), e => answer('outresult', m.id, failure('threw', message(e))))
          }
          default: return drop(`unexpected ${m.type}`)
        }
      }

      const off = deps.onApplied(() => { if (!failed) try { post({ type: 'edges', edges: deps.edges(self) }) } catch (e) { fail(message(e)) } })
      const mine = naming(self)
      const unheard = deps.app().listen(e => { if (!failed && mine(e)) try { post({ type: 'stream', event: e }) } catch (x) { drop(`stream: ${message(x)}`) } })
      // Added first, so a failed build (nano closes it) lets go of the frame too.
      ctx.addOnCloseListener(async ({ reason }) => {
        off(); unheard()
        if (!failed) {
          const done = new Promise<void>(res => { closed = res })
          try { post({ type: 'close', reason }); await bounded(done, ms, 'no closed') } catch { /* gone or late: disposed anyway */ }
        }
        fail('closed')
        frame.dispose()
      })

      post({ type: 'build', pod: self, runtimes: [...ctx.runtimes], coord: real.coord, url: deps.url, config, edges: deps.edges(self) })
      frame.ready.catch(e => fail(message(e)))
      try { await bounded(Promise.all([frame.ready, gate]), ms, `no ready within ${ms}ms`) } catch (e) { fail(message(e)); throw new Error(failed) }

      const call = (p: string, input: unknown) => new Promise<NanoResult<unknown>>(res => {
        if (failed) return res(failure('threw', failed))
        const id = ++n
        pending.set(id, res)
        try { post({ type: 'call', id, port: p, input }) } catch (e) { pending.delete(id); res(failure('threw', `${self}: ${message(e)}`)) }
      })
      const handlers = new Map<string, Handler>()
      for (const i of real.provides) for (const o of Object.values(i.ops)) if (o.kind === 'action') handlers.set(port(i, o), input => call(port(i, o), input))
      return handlers
    },
  }
}
