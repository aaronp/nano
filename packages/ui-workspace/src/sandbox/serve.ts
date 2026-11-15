/**
 * The frame's side: builds one pod from the implementation `load` gives for the `build` message's URL and answers
 * the port. Calls in, results out; the pod's publishes and outcalls go out; `close` runs its close listeners.
 *
 *   serve(port, url => import(url).then(m => m.default.implementations.get(coord)))
 */
import { failure, type Handler, type Implementation, type NanoResult } from '@pritzlaff/nano-core'
import type { Edge } from './edges.ts'
import { frameContext } from './frame-context.ts'
import { checkMsg, type Msg } from './protocol.ts'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function serve(port: MessagePort, load: (url: string) => Promise<Implementation>): void {
  const post = (m: Msg) => port.postMessage(m)
  const outs = new Map<number, (r: NanoResult<unknown>) => void>()
  let edges: Edge[] = [], handlers: ReadonlyMap<string, Handler> | undefined, building = false, n = 0
  let close: ((reason: 'restarted' | 'removed' | 'changed' | 'closed') => Promise<void>) | undefined

  const out = (pod: string, runtime: string, op: string, input: unknown) => new Promise<NanoResult<unknown>>(res => {
    const id = ++n
    outs.set(id, res)
    try { post({ type: 'outcall', id, pod, runtime, op, input }) } catch (e) { outs.delete(id); res(failure('invalid-input', message(e))) }
  })

  async function build(m: Extract<Msg, { type: 'build' }>) {
    if (building) return console.warn('sandbox: dropped a second build')
    building = true
    edges = m.edges
    try {
      const impl = await load(m.url)
      if (impl.coord !== m.coord) throw new Error(`${m.url} gave ${impl.coord} for ${m.coord}`)
      const made = frameContext(m.pod, m.runtimes, () => edges, post, out)
      close = made.close
      handlers = await impl.make(made.ctx, m.config)
      post({ type: 'ready' })
    } catch (e) { post({ type: 'failed', error: message(e) }) }
  }

  async function call(id: number, p: string, input: unknown) {
    const h = handlers?.get(p)
    const r = h ? await Promise.resolve().then(() => h(input)).catch(e => failure('threw', message(e))) : failure('unknown-op', `no handler for ${p}`)
    try { post({ type: 'result', id, result: r }) } catch (e) { post({ type: 'result', id, result: failure('invalid-output', message(e)) }) }
  }

  port.onmessage = ({ data }) => {
    const m = checkMsg(data)
    if (typeof m === 'string') return console.warn(`sandbox: dropped message: ${m}`)
    switch (m.type) {
      case 'build': return void build(m)
      case 'call': return void call(m.id, m.port, m.input)
      case 'outresult': { const res = outs.get(m.id); outs.delete(m.id); return res?.(m.result) }
      case 'edges': edges = m.edges; return
      case 'close': return void (close ?? (async () => {}))(m.reason).then(() => post({ type: 'closed' }))
      default: return console.warn(`sandbox: dropped message of type ${m.type}`)
    }
  }
}
