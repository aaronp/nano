/**
 * The frame's side: builds one pod from the implementation `load` gives for the `build` message's URL and coord and
 * answers the port. Calls in, results out; the pod's publishes and outcalls go out; `close` runs its close listeners.
 * Once built, `render` gets a view target whose app reaches only this pod (`view-call`) and hears its `stream`;
 * `probe` answers `probe` with `described`.
 *
 *   serve(port, (url, coord) => import(url).then(m => m.default.implementations.get(coord)), { render, probe })
 */
import { failure, type AppDeployment, type AppEvent, type Application, type Handler, type Implementation, type NanoResult } from '@pritzlaff/nano-core'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import type { Edge } from './edges.ts'
import { frameContext } from './frame-context.ts'
import { checkMsg, type Described, type Msg } from './protocol.ts'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
type R = NanoResult<unknown>
type Opts = { render?(coord: string, target: Omit<ViewTarget, 'registry'>): void; probe?(url: string): Promise<Described[]> }

export function serve(port: MessagePort, load: (url: string, coord: string) => Promise<Implementation>, opts: Opts = {}): void {
  const post = (m: Msg) => port.postMessage(m)
  const outs = new Map<number, (r: R) => void>(), heard = new Set<(e: AppEvent) => void>()
  let edges: Edge[] = [], handlers: ReadonlyMap<string, Handler> | undefined, building = false, n = 0
  let close: ((reason: 'restarted' | 'removed' | 'changed' | 'closed') => Promise<void>) | undefined

  /** Posts `m` with a fresh id and resolves with the answer to that id (`outresult` or `view-result`). */
  const ask = (m: (id: number) => Msg) => new Promise<R>(res => {
    const id = ++n
    outs.set(id, res)
    try { post(m(id)) } catch (e) { outs.delete(id); res(failure('invalid-input', message(e))) }
  })
  const out = (pod: string, runtime: string, op: string, input: unknown) => ask(id => ({ type: 'outcall', id, pod, runtime, op, input }))

  /** What a view in the frame sees: its own pod's client, its pod's events, and a deployment of just its pod. */
  function viewApp(m: Extract<Msg, { type: 'build' }>): Application {
    const no = async () => failure('invalid-input', `${m.pod}: a sandboxed view reaches only its own pod`)
    const refused = { type: 'invalid-input' as const, reason: `${m.pod}: a sandboxed view reaches only its own pod` }
    const client = (pod: string) => new Proxy({}, { get: (_, op) => typeof op !== 'string' || op === 'then' ? undefined
      : pod === m.pod ? (input: unknown) => ask(id => ({ type: 'view-call', id, op, input })) : no })
    const deployment: AppDeployment = { pods: { [m.pod]: { implementation: m.coord, eager: true, config: m.config } },
      runtimes: Object.fromEntries(m.runtimes.map(r => [r, { pods: [m.pod], subscriptions: [] }])) }
    return {
      call: (_, pod) => client(pod) as ReturnType<Application['call']>, deployment: () => structuredClone(deployment),
      listen(fn) { heard.add(fn); return () => { heard.delete(fn) } }, apply: no, restart: no, close: no,
      // A view uses call: resolve finds nothing, and get throws its Fail, as app.get's would on a missing pod.
      resolve: () => ({ ok: false, fail: refused, getOrThrow: () => { throw Object.assign(new Error(refused.reason), { fail: refused }) } }),
      get: () => { throw Object.assign(new Error(refused.reason), { fail: refused }) },
    }
  }

  async function build(m: Extract<Msg, { type: 'build' }>) {
    if (building) return console.warn('sandbox: dropped a second build')
    building = true
    edges = m.edges
    try {
      const impl = await load(m.url, m.coord)
      if (impl.coord !== m.coord) throw new Error(`${m.url} gave ${impl.coord} for ${m.coord}`)
      const made = frameContext(m.pod, m.runtimes, () => edges, post, out)
      close = made.close
      handlers = await impl.make(made.ctx, m.config)
      post({ type: 'ready' })
    } catch (e) { return post({ type: 'failed', error: message(e) }) }
    try { opts.render?.(m.coord, { app: viewApp(m), runtime: m.runtimes[0]!, pod: m.pod }) }
    catch (e) { post({ type: 'warn', reason: `${m.pod}: its view failed: ${message(e)}` }) }
  }

  async function call(id: number, p: string, input: unknown) {
    const h = handlers?.get(p)
    const r = h ? await Promise.resolve().then(() => h(input)).catch(e => failure('threw', message(e))) : failure('unknown-op', `no handler for ${p}`)
    try { post({ type: 'result', id, result: r }) } catch (e) { post({ type: 'result', id, result: failure('invalid-output', message(e)) }) }
  }

  async function probe(url: string) {
    try { post({ type: 'described', providers: await (opts.probe ?? (async () => { throw new Error('no probe here') }))(url) }) }
    catch (e) { post({ type: 'failed', error: message(e) }) }
  }

  port.onmessage = ({ data }) => {
    const m = checkMsg(data)
    if (typeof m === 'string') return console.warn(`sandbox: dropped message: ${m}`)
    switch (m.type) {
      case 'build': return void build(m)
      case 'call': return void call(m.id, m.port, m.input)
      case 'outresult': case 'view-result': { const res = outs.get(m.id); outs.delete(m.id); return res?.(m.result) }
      case 'edges': edges = m.edges; return
      case 'stream': for (const fn of heard) try { fn(m.event as AppEvent) } catch (e) { console.warn(`sandbox: a listener threw: ${message(e)}`) } return
      case 'probe': return void probe(m.url)
      case 'close': return void (close ?? (async () => {}))(m.reason).then(() => post({ type: 'closed' }))
      default: return console.warn(`sandbox: dropped message of type ${m.type}`)
    }
  }
}
