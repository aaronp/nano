import Value from 'typebox/value'
import { context, scoped, type Core } from '../context'
import {
  fail, ok,
  type Action, type Called, type Component, type ComponentFactory, type Context, type Emitted, type Event,
  type Frame, type Instance, type Manifest, type Result, type Subscribed, type SystemError,
} from '../types'

/** A set of named instances sharing one bus. A container makes its own scope for its children. */
export type Scope = {
  add<F extends ComponentFactory>(name: string, factory: F, wrap?: (c: Context) => Context): Promise<Awaited<ReturnType<F['create']>>>
  remove(name: string): Promise<void>
  component(name: string): Component | undefined
  /** Deliver `event` from `from` to `to`'s `action` (validated; failures go to onError). Returns unroute. */
  route(from: string, event: Event, to: string, action: Action): () => void
  /** A context for a party that is not a component (e.g. the page hosting this scope). It cannot emit. */
  context(name: string): Context
  clear(): Promise<void>
}

type Entry = { name: string; manifest: Manifest; ctx: Context; component?: Component } // no component while being created
type Sub = Subscribed & { owner?: Entry }
type Watch = { owner?: Entry; notify: () => void }
export type ErrorInfo = { from: string; name: string; stack: Frame[] }

/**
 * Synchronous pub/sub, after kerits' EventBus: handlers run in subscription order; an emit made while handlers
 * run is queued and delivered after the current round (FIFO). `stack` stops feedback loops at `maxDepth`.
 */
export function scope(opts: { maxDepth?: number; maxRound?: number; onError?: (e: SystemError, info: ErrorInfo) => void } = {}): Scope {
  const entries = new Map<string, Entry>()
  const subs = new Set<Sub>(), watchers = new Set<Watch>()
  const maxDepth = opts.maxDepth ?? 16
  const report = (e: SystemError, info: ErrorInfo) => { try { opts.onError?.(e, info) } catch {} }
  const reportResult = (r: Result<unknown>, info: ErrorInfo) => { if (r.type === 'error') report(r.error, info) }
  const present = (e?: Entry) => !e || entries.get(e.name) === e
  const live = (e?: Entry) => !e || (present(e) && !!e.component)
  const gone = (name: string) => fail('unknown-target', `instance ${name} was removed`)
  const notify = () => { for (const w of watchers) if (live(w.owner)) try { w.notify() } catch {} }
  const instances = (): Instance[] => [...entries.values()].filter(e => e.component).map(e => ({ name: e.name, manifest: e.manifest }))

  let dispatching = false
  const queue: (() => void)[] = []
  // Backstop for loops that bypass the stack (a handler emitting through a context without it): cap one round.
  const maxRound = opts.maxRound ?? 10_000
  const dispatch = (run: () => void) => {
    if (dispatching) return void queue.push(run)
    dispatching = true
    try {
      run()
      for (let n = 0; queue.length; n++) {
        if (n >= maxRound) { report({ code: 'loop', message: `more than ${maxRound} events in one dispatch` }, { from: '', name: '', stack: [] }); break }
        queue.shift()!()
      }
    } finally { dispatching = false; queue.length = 0 }
  }

  function emit(from: string, manifest: Manifest | undefined, e: Emitted): Result<void> {
    const name = e.event.name, info = { from, name, stack: e.stack }
    const def = manifest?.emits.find(d => d.name === name)
    if (!def) return fail('validation', `${from} does not emit ${name}`)
    if (!Value.Check(def.schema, e.payload)) return fail('validation', `payload invalid for ${name}`)
    if (e.stack.length >= maxDepth) { const r = fail('loop', `depth ${e.stack.length} reached max ${maxDepth}`); reportResult(r, info); return r }
    const stack = [...e.stack, { from, name }]
    dispatch(() => {
      for (const s of [...subs]) {
        if (s.event.name !== name || (s.from && s.from !== from) || !subs.has(s) || !live(s.owner)) continue
        try { void Promise.resolve(s.fn(e.payload, { from, event: name, stack, ctx: undefined! })).catch(err => report({ code: 'handler', message: String(err?.message ?? err) }, info)) }
        catch (err: any) { report({ code: 'handler', message: String(err?.message ?? err) }, info) }
      }
    })
    return ok(undefined)
  }

  async function call(from: string, c: Called): Promise<Result<unknown>> {
    const name = c.action.name
    if (c.stack.length >= maxDepth) return fail('loop', `depth ${c.stack.length} reached max ${maxDepth}`)
    const e = entries.get(c.target)
    if (!e?.component) return fail('unknown-target', `no instance ${c.target}`)
    const def = e.manifest.consumes.find(a => a.name === name)
    if (!def) return fail('unknown-action', `${c.target} has no action ${name}`)
    if (!Value.Check(def.input, c.input)) return fail('validation', `input invalid for ${name}`)
    try {
      const stack = [...c.stack, { from, name }]
      const r = await e.component.onAction(scoped(e.ctx, stack), { id: crypto.randomUUID(), from, target: c.target, action: name, input: c.input, stack: c.stack })
      if (def.output && r.type === 'success' && !Value.Check(def.output, r.data)) return fail('validation', `output invalid for ${name}`)
      return r
    } catch (err: any) { return fail('handler', String(err?.message ?? err)) }
  }

  const coreFor = (name: string, owner: Entry | undefined): Core => ({
    self: name,
    emit: async e => live(owner) ? emit(name, owner?.manifest, e) : gone(name),
    call: c => live(owner) ? call(name, c) : Promise.resolve(gone(name)),
    on: s => {
      if (!present(owner)) return () => {}
      const sub: Sub = { ...s, owner }; subs.add(sub); return () => { subs.delete(sub) }
    },
    instances,
    watch: n => {
      if (!present(owner)) return () => {}
      const w: Watch = { owner, notify: n }; watchers.add(w); return () => { watchers.delete(w) }
    },
  })

  async function remove(name: string) {
    const e = entries.get(name)
    if (!e) return
    entries.delete(name)
    for (const s of subs) if (s.owner === e) subs.delete(s)
    for (const w of watchers) if (w.owner === e) watchers.delete(w)
    await e.component?.dispose?.()
    notify()
  }

  return {
    async add(name, factory, wrap) {
      if (entries.has(name)) throw new Error(`duplicate instance ${name}`)
      const entry: Entry = { name, manifest: factory.manifest, ctx: undefined! }
      entries.set(name, entry)
      try {
        entry.ctx = (wrap ?? (c => c))(context(coreFor(name, entry)))
        entry.component = await factory.create(entry.ctx)
        notify()
        return entry.component as never
      } catch (err) { await remove(name); throw err }
    },
    remove,
    component: name => entries.get(name)?.component,
    route(from, event, to, action) {
      return coreFor('', undefined).on({
        event, from,
        fn: (payload, d) => call(from, { target: to, action, input: payload, stack: d.stack })
          .then(r => reportResult(r, { from, name: action.name, stack: d.stack })),
      })
    },
    context: name => context(coreFor(name, undefined)),
    async clear() { for (const name of [...entries.keys()].reverse()) await remove(name) },
  }
}
