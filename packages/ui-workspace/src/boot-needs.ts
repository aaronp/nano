/**
 * Needs in the host: a new instance with a need nothing settled asks for it (one chooser at a time, never while a
 * document is being applied); a placed element with an unbound need is marked `data-unbound` (dimmed, with a button that
 * asks again); one whose instance declares needs is marked `data-needs`, so its dock panel shows Dependencies.
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

  /** Asks for one need until it is bound, made, or cancelled (import asks again after). */
  const settle = async (n: Need) => {
    const { system, id } = parse(n.ref)
    const iface = registryOf(system)?.get(id)?.component.needs?.[n.need]
    if (!iface) return
    for (;;) {
      const [snaps, kinds, needs] = await Promise.all([call<Snapshot[]>(P.systems), call<{ kind: string; implements?: string[] }[]>(P.kinds), call<NeedOf[]>(P.needsOf, n.ref)])
      const choice = await chooseBinding(doc, n, optionsFor({ id: iface.id, ops: Object.values(iface.ops).map(op => Ops.key(op)) }, n.ref, snaps, kinds))
      if (!choice) return
      if ('import' in choice) { await opts.importPackage(); continue }
      if ('bind' in choice) return call(P.bindNeed, { ref: n.ref, need: n.need, to: choice.bind })
      const layer = needs.find(x => x.need === n.need)?.selector.layer ?? system
      const name = nextName(choice.make, new Set(snaps.find(s => s.id === layer)?.instances.map(i => i.id)))
      await call(P.createComponent, { kind: choice.make, name, system: layer })   // its own needs queue on instance-added
      return call(P.bindNeed, { ref: n.ref, need: n.need, to: `instance:${layer}/${name}` })
    }
  }
  const queue: Need[] = []
  let running = false
  const pump = async () => {
    if (running) return
    running = true
    try {
      for (let n; (n = queue.shift());) {
        if (!unbound(n.ref).some(u => u.need === n!.need)) continue   // settled meanwhile
        try { await settle(n) } catch (e) { showStatus(doc, `Could not set ${n.need}: ${e instanceof Error ? e.message : e}`) }
      }
    } finally { running = false }
  }
  const ask = (needs: Need[]) => { for (const n of needs) if (!queue.some(q => q.ref === n.ref && q.need === n.need)) queue.push(n); void pump() }

  /** Marks every placed element: `data-needs` if its instance declares any, `data-unbound` (and the button) for the ones not bound. */
  const overlays = new WeakMap<Element, HTMLButtonElement>()
  const mark = (snaps: Snapshot[]) => {
    const unboundBy = new Map<string, string[]>(snaps.flatMap(s => [...Map.groupBy(unboundOf(s), u => u.instance)].map(([i, us]) => [`${s.id}/${i}`, us.map(u => u.need)] as const)))
    const declares = new Set(snaps.flatMap(s => s.instances.filter(i => i.needs && Object.keys(i.needs).length).map(i => `${s.id}/${i.id}`)))
    for (const el of doc.querySelectorAll('*')) {
      if (!(el instanceof PlacedElement) || !el.registry || !el.model) continue
      const key = `${el.registry.id}/${el.model}`, needs = unboundBy.get(key)
      el.toggleAttribute('data-needs', declares.has(key))
      let b = overlays.get(el)
      if (!needs) { el.removeAttribute('data-unbound'); b?.remove(); overlays.delete(el); continue }
      el.setAttribute('data-unbound', needs.join(','))
      if (!b) {
        b = Object.assign(doc.createElement('button'), { type: 'button', className: 'needs-choose' })
        b.addEventListener('click', () => ask(unbound(`instance:${key}`)))
        overlays.set(el, b)
      }
      b.textContent = unboundLabel(needs)
      if (b.nextElementSibling !== el) el.before(b)
    }
  }

  let published = false
  const off = host.listen(t => {
    if (t.kind !== 'publish' || t.from.instance !== 'application') return
    if (t.op === Ops.key(P.systems)) { published = true; mark(t.data as Snapshot[]) }
    const d = t.data as { system?: string; delta?: { type: string; instance?: string } }
    // after the Application's auto-bind (a microtask after the delta)
    if (t.op === Ops.key(P.stateChanged) && d.delta?.type === 'instance-added') {
      const ref = `instance:${d.system}/${d.delta.instance}`
      setTimeout(() => { if (!opts.busy()) ask(unbound(ref)) })
    }
  })
  // a dock's Dependencies button: the panel's instance
  const onDeps = (e: Event) => {
    const { system, instance } = (e as CustomEvent<{ system: string; instance: string }>).detail, ref = `instance:${system}/${instance}`
    void call<NeedOf[]>(P.needsOf, ref).then(needs => showDependencies(doc, ref, needs, async need => {
      const n = needs.find(x => x.need === need)!
      try { await settle({ ref, need, implements: n.implements }) } catch (err) { showStatus(doc, `Could not set ${need}: ${err instanceof Error ? err.message : err}`) }
    }), err => showStatus(doc, String(err instanceof Error ? err.message : err)))
  }
  doc.addEventListener('dock:dependencies', onDeps)
  void call<Snapshot[]>(P.systems).then(snaps => { if (!published) mark(snaps) }, () => {})   // a publish since is newer
  return () => { off(); doc.removeEventListener('dock:dependencies', onDeps) }
}
