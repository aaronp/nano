// The host's side of a sandboxed instance: a component with the entry's ops whose calls go over a port.
import { Components, Ops, err, isOk, type Component, type Op, type Result } from '@pritzlaff/nano-core'
import { Value } from 'typebox/value'
import { asResult, type Msg, type SerialEntry } from './protocol'

/** A way to the other side: the port, when it is ready, and how to let go of it. `ready` is the opener's signal (it rejects on a
 * timeout or load error); the stand-in also listens on the port for the iframe's own `ready` and `failed` messages. */
export type Frame = { port: MessagePort; ready: Promise<void>; dispose(): void; element?: HTMLIFrameElement }

/** The op named by a key (`ns/name`; the ns may contain `/`). */
const opOf = (key: string): Op => { const i = key.lastIndexOf('/'); return { ns: key.slice(0, i), name: key.slice(i + 1) } }
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Link = { call(key: string, arg: unknown): Promise<Result> }
const check = (schema: object, v: unknown) => { try { return Value.Check(schema as never, v) } catch { return false } }   // a schema off the wire may throw
const links = new WeakMap<Frame, Link>()

/** The stand-in component for `entry`; `open` makes the frame for each instance. */
export function standIn(entry: SerialEntry, open: () => Frame): Component<Frame> {
  const offered = new Map(entry.ops.map(o => [Ops.key(o), o]))
  const c = Components.create<Frame>(entry.id, env => {
    const frame = open(), pending = new Map<number, { op: Op; res: (r: Result) => void }>()
    let failure: string | undefined, n = 0, release!: () => void, abort!: () => void
    const gate = new Promise<void>((res, rej) => { release = res; abort = () => rej(new Error('failed')) })
    gate.catch(() => {})
    const name = () => env.handles()[0]?.coord.instance ?? entry.id.name
    const fail = (why: string) => {
      failure ??= `${name()}: ${why}`
      for (const p of pending.values()) p.res(err(failure))
      pending.clear()
      abort()
    }
    const drop = (why: string) => console.warn(`sandbox ${name()}: dropped message: ${why}`)
    frame.ready.catch(e => fail(message(e)))
    const removed = env.removed   // the last registry letting go of the instance lets go of the frame (a wrap or unwrap hands it over within a tick)
    env.removed = coord => { removed(coord); queueMicrotask(() => { if (!env.handles().length) frame.dispose() }) }
    links.set(frame, {
      async call(key, arg) {
        await Promise.race([frame.ready, gate]).catch(() => {})
        if (failure) return err(failure)
        const id = ++n
        const done = new Promise<Result>(res => pending.set(id, { op: offered.get(key)!, res }))
        try { frame.port.postMessage({ type: 'call', id, op: key, arg } satisfies Msg) } catch (e) { pending.delete(id); return err(`${name()}: ${message(e)}`) }
        return done
      },
    })
    frame.port.onmessage = ({ data: m }) => {
      const msg = m as Record<string, unknown> | null
      if (!msg || typeof msg !== 'object') return drop('not an object')
      switch (msg.type) {
        case 'result': {
          const p = typeof msg.id === 'number' ? pending.get(msg.id) : undefined
          if (!p) return drop('result for no call')
          pending.delete(msg.id as number)
          const r = asResult(msg.result)
          if (!r) return p.res(err('malformed result'))
          if ('value' in r && p.op.output && !check(p.op.output, r.value)) return p.res(err(`invalid result for ${Ops.key(p.op)}`))
          return p.res(r)
        }
        case 'publish': {
          if (failure) return
          const op = typeof msg.op === 'string' ? offered.get(msg.op) : undefined
          if (!op?.output) return drop(`op ${String(msg.op)} is not offered`)
          if (!check(op.output, msg.data)) return drop(`invalid data for ${msg.op}`)
          void env.notify(op, msg.data)
          return
        }
        case 'outcall': {
          if (failure) return
          const { id, target, op, arg } = msg, h = env.handles()[0]
          if (typeof id !== 'number' || typeof target !== 'string' || typeof op !== 'string' || !op.includes('/')) return drop('malformed outcall')
          const reply = (result: Result) => {
            try { frame.port.postMessage({ type: 'outresult', id, result } satisfies Msg) }
            catch (e) { try { frame.port.postMessage({ type: 'outresult', id, result: err(message(e)) } satisfies Msg) } catch { /* port gone */ } }
          }
          void (h ? h.call(target, opOf(op), arg) : Promise.resolve(err('not in a registry'))).then(reply, e => reply(err(message(e))))
          return
        }
        case 'failed': return fail(typeof msg.error === 'string' ? msg.error : 'failed')
        case 'ready': return release()
        default: return drop(`unknown type ${String(msg.type)}`)
      }
    }
    return frame
  }, entry.description === undefined ? {} : { description: entry.description })

  for (const op of entry.ops) {
    if (!op.input) { c.action(op); continue }   // a source: published when the other side publishes it
    const key = Ops.key(op)
    c.action(op as Op<any, any>, async (frame: Frame, arg: unknown) => {
      const r = await links.get(frame)!.call(key, arg)
      if (!isOk(r)) throw new Error(r.error)
      return r.value
    })
  }
  return c
}
