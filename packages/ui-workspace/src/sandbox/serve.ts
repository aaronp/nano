// The iframe's side: runs one catalog entry's component in a registry of its own and answers a port.
import { Components, Registries, Runtimes, err, isOk, type Result } from '@pritzlaff/nano-core'
import type { Catalog } from '@pritzlaff/nano-elements'
import type { Registry } from '@pritzlaff/nano-core'
import { asResult, serialEntry, type Msg } from './protocol'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Serves `catalog[kind]` over `port`: calls in, results and the instance's publishes out; calls to anything else go out as outcalls. */
export function serve(port: MessagePort, catalog: Catalog, kind: string, opts: { render?(tag: string, registry: Registry, name: string): void } = {}): void {
  const send = (m: Msg) => port.postMessage(m)
  const entry = catalog[kind]
  if (!entry) return send({ type: 'failed', error: `no kind ${kind}` })
  const outs = new Map<number, (r: Result) => void>()
  let n = 0
  try {
    const rt = Runtimes.create(Registries.create('sandbox'), inner => ({
      ...inner,
      call(f, t, op, arg) {
        if (t !== 'registry' && inner.registry.get(t)) return inner.call(f, t, op, arg)
        const id = ++n, done = new Promise<Result>(res => outs.set(id, res))
        try { send({ type: 'outcall', id, target: t, op, arg }) } catch (e) { outs.delete(id); return Promise.resolve(err(message(e))) }
        return done
      },
    }))
    const added = rt.registry.add('it', Components.instantiate(entry.component))
    if (!isOk(added)) return send({ type: 'failed', error: added.error })
    rt.listen(t => { if (t.kind === 'publish' && t.from.instance === 'it' && isOk(t.result)) try { send({ type: 'publish', op: t.op, data: t.data }) } catch { /* not cloneable: not sent */ } })
    port.onmessage = ({ data: m }) => {
      const msg = m as Record<string, unknown> | null
      if (!msg || typeof msg !== 'object' || typeof msg.id !== 'number') return console.warn('sandbox: dropped malformed message')
      if (msg.type === 'call' && typeof msg.op === 'string') {
        const id = msg.id
        void rt.call({ registry: 'sandbox', instance: 'host' }, 'it', msg.op, msg.arg).then(result => {
          try { send({ type: 'result', id, result }) } catch (e) { send({ type: 'result', id, result: err(message(e)) }) }
        })
      } else if (msg.type === 'outresult') {
        const res = outs.get(msg.id), r = asResult(msg.result)
        outs.delete(msg.id)
        res?.(r ?? err('malformed result'))
      } else console.warn('sandbox: dropped message of unknown type')
    }
    if (opts.render && entry.tag) opts.render(entry.tag, rt.registry, 'it')
    send({ type: 'ready' })
  } catch (e) { send({ type: 'failed', error: message(e) }) }
}

/** Posts the catalog as data, for a host to check. */
export function probe(port: MessagePort, catalog: Catalog): void {
  port.postMessage({ type: 'catalog', entries: Object.fromEntries(Object.entries(catalog).map(([k, e]) => [k, serialEntry(e)])) } satisfies Msg)
}
