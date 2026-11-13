/**
 * Needs in the host: a new instance with a need nothing settled asks for it (one chooser at a time, never while a
 * document is being applied); a placed element with an unbound need is marked `data-unbound` (dimmed, with a button that
 * asks again, and the element is `inert`); one whose instance declares needs is marked `data-needs`, so its dock panel
 * shows Dependencies. Making a provider asks for its own needs first (depth first); the requester binds to it only once
 * it is settled, so a cancel anywhere in that chain leaves the requester disabled.
 */
import { Ops, type Op, type Runtime, type Snapshot } from '@pritzlaff/nano-core'
import { PlacedElement } from '@pritzlaff/nano-elements'
import { ApplicationOps as P, runtimeOf, unboundOf } from '@pritzlaff/nano-app'
import { chooseBinding, showDependencies } from './components/needs-dialog.ts'
import { showStatus } from './lib/status.ts'

type Need = { ref: string; need: string; implements: string }
type NeedOf = { need: string; implements: string; selector: { layer?: string }; binding?: string }

/** `<kind>-<n>` with the first `n` not taken. */
export const nextName = (kind: string, taken: Set<string>) => { let n = 1; while (taken.has(`${kind}-${n}`)) n++; return `${kind}-${n}` }

/** The disabled panel's button. */
export const unboundLabel = (needs: string[]) => `Needs ${needs.join(', ')} — Choose…`

/** What the chooser offers: instances in any system (not the requester) offering every op of the interface, and the
 * kinds that implement it. */
export const optionsFor = (iface: { id: string; ops: string[] }, requester: string, snaps: Snapshot[], kinds: { kind: string; implements?: string[] }[]) => ({
  candidates: snaps.flatMap(s => s.instances.flatMap(i => {
    const ref = `instance:${s.id}/${i.id}`, keys = new Set(i.ops.map(op => Ops.key(op)))
    return ref !== requester && iface.ops.every(k => keys.has(k)) ? [ref] : []
  })),
  kinds: kinds.filter(k => k.implements?.includes(iface.id)).map(k => k.kind),
})

const parse = (ref: string) => { const [system, ...rest] = ref.slice('instance:'.length).split('/'); return { system: system!, id: rest.join('/') } }

export function bootNeeds(doc: Document, host: Runtime, opts: { busy(): boolean; importPackage(): Promise<void> }) {
  const me = { registry: host.registry.id, instance: 'needs' }
  const call = async <T>(op: Op, arg: unknown = null): Promise<T> => {
    const r = await host.call(me, 'application', Ops.key(op), arg)
    if ('error' in r) throw new Error(r.error)
    return r.value as T
  }
  const registryOf = (system: string) => runtimeOf(host.registry, system)?.registry
  /** The declared needs of an instance with no binding. */
  const unbound = (ref: string) => {
    const { system, id } = parse(ref), reg = registryOf(system)
    return Object.entries(reg?.get(id)?.component.needs ?? {}).filter(([n]) => !reg!.binding(id, n)).map(([need, i]) => ({ ref, need, implements: i.id }))
  }
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (f: () => void) => { const t = setTimeout(() => { timers.delete(t); f() }); timers.add(t) }
  /** Instances being made by a chooser: their needs are asked inline, not queued. */
  const making = new Set<string>()

  /** Asks for one need until it is bound (true), or cancelled (false). Import asks again after. Making one asks for the
   * made instance's own unbound needs first, and binds only if they all settle. */
  const settle = async (n: Need): Promise<boolean> => {
    const { system, id } = parse(n.ref)
    const iface = registryOf(system)?.get(id)?.component.needs?.[n.need]
    if (!iface) return false
    for (;;) {
      const [snaps, kinds, needs] = await Promise.all([call<Snapshot[]>(P.systems), call<{ kind: string; implements?: string[] }[]>(P.kinds), call<NeedOf[]>(P.needsOf, n.ref)])
      const choice = await chooseBinding(doc, n, optionsFor({ id: iface.id, ops: Object.values(iface.ops).map(op => Ops.key(op)) }, n.ref, snaps, kinds))
      if (!choice) return false
      if ('import' in choice) { await opts.importPackage(); continue }
      if ('bind' in choice) { await call(P.bindNeed, { ref: n.ref, need: n.need, to: choice.bind }); return true }
      const layer = needs.find(x => x.need === n.need)?.selector.layer ?? system
      const name = nextName(choice.make, new Set(snaps.find(s => s.id === layer)?.instances.map(i => i.id)))
      const made = `instance:${layer}/${name}`
      making.add(made)
      try {
        await call(P.createComponent, { kind: choice.make, name, system: layer })
        await new Promise(r => later(() => r(null)))   // after its auto-bind
        for (const m of unbound(made)) if (!(await settle(m))) return false   // it stays, disabled; so does the requester
      } finally { making.delete(made) }
      await call(P.bindNeed, { ref: n.ref, need: n.need, to: made })
      return true
    }
  }
  /** One chooser at a time: new instances' needs and Replace… both wait here. */
  const queue: { n: Need; replace?: boolean; done?(): void }[] = []
  let running = false
  const pump = async () => {
    if (running) return
    running = true
    try {
      for (let q; (q = queue.shift());) {
        const { n } = q
        try { if (q.replace || unbound(n.ref).some(u => u.need === n.need)) await settle(n) }   // else settled meanwhile
        catch (e) { showStatus(doc, `Could not set ${n.need}: ${e instanceof Error ? e.message : e}`) }
        finally { q.done?.() }
      }
    } finally { running = false }
  }
  const ask = (needs: Need[]) => { for (const n of needs) if (!queue.some(q => q.n.ref === n.ref && q.n.need === n.need)) queue.push({ n }); void pump() }
  const replace = (n: Need) => new Promise<void>(done => { queue.push({ n, replace: true, done }); void pump() })

  /** Marks every placed element: `data-needs` if its instance declares any; `data-unbound` and `inert`, with the button
   * after it (so it stays reachable, and the panel's first element is still the instance's), for the ones not bound. */
  const overlays = new Map<Element, HTMLButtonElement>()
  const clear = (el: Element) => { el.removeAttribute('data-unbound'); el.removeAttribute('inert'); overlays.get(el)?.remove(); overlays.delete(el) }
  const mark = (snaps: Snapshot[]) => {
    const unboundBy = new Map<string, string[]>(snaps.flatMap(s => [...Map.groupBy(unboundOf(s), u => u.instance)].map(([i, us]) => [`${s.id}/${i}`, us.map(u => u.need)] as const)))
    const declares = new Set(snaps.flatMap(s => s.instances.filter(i => i.needs && Object.keys(i.needs).length).map(i => `${s.id}/${i.id}`)))
    for (const el of overlays.keys()) if (!el.isConnected) clear(el)
    for (const el of doc.querySelectorAll('*')) {
      if (!(el instanceof PlacedElement) || !el.registry || !el.model) continue
      const key = `${el.registry.id}/${el.model}`, needs = unboundBy.get(key)
      el.toggleAttribute('data-needs', declares.has(key))
      if (!needs) { if (overlays.has(el)) clear(el); continue }
      el.setAttribute('data-unbound', needs.join(',')); el.setAttribute('inert', '')
      let b = overlays.get(el)
      if (!b) {
        b = Object.assign(doc.createElement('button'), { type: 'button', className: 'needs-choose' })
        b.addEventListener('click', () => ask(unbound(`instance:${key}`)))
        overlays.set(el, b)
      }
      b.textContent = unboundLabel(needs)
      if (b.previousElementSibling !== el) el.after(b)
    }
  }

  let published = false
  const off = host.listen(t => {
    if (t.kind !== 'publish' || t.from.instance !== 'application') return
    if (t.op === Ops.key(P.systems)) { published = true; mark(t.data as Snapshot[]) }
    const d = t.data as { system?: string; delta?: { type: string; instance?: string } }
    if (t.op === Ops.key(P.stateChanged) && d.delta?.type === 'instance-added') {
      const ref = `instance:${d.system}/${d.delta.instance}`
      // read now, not later: an apply may be over by the time the timeout runs
      if (opts.busy() || making.has(ref)) return
      later(() => ask(unbound(ref)))   // after the Application's auto-bind (a microtask after the delta)
    }
  })
  /** The Dependencies dialog for `ref`: Replace… waits in the queue; a bound row's Dependencies… opens its target's. */
  const dependencies = async (ref: string): Promise<void> => {
    const needs = await call<NeedOf[]>(P.needsOf, ref)
    await showDependencies(doc, ref, needs, need => replace({ ref, need, implements: needs.find(x => x.need === need)!.implements }), dependencies)
  }
  const onDeps = (e: Event) => {
    const { system, instance } = (e as CustomEvent<{ system: string; instance: string }>).detail
    dependencies(`instance:${system}/${instance}`).catch(err => showStatus(doc, String(err instanceof Error ? err.message : err)))
  }
  doc.addEventListener('dock:dependencies', onDeps)
  void call<Snapshot[]>(P.systems).then(snaps => { if (!published) mark(snaps) }, () => {})   // a publish since is newer
  return () => {
    off(); doc.removeEventListener('dock:dependencies', onDeps)
    for (const t of timers) clearTimeout(t)
    timers.clear()
    for (const el of [...overlays.keys()]) clear(el)
  }
}
