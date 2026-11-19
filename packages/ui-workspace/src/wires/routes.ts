// The Routes list's chain text: each route as `owner.op → owner.op`, a fork where one output feeds several inputs.
import { ownerLabel, portName, type Model, type Wire } from './model'

type Node = { kind: 'src' | 'sink'; key: string } | { kind: 'module'; id: string }

/** A module's primary input is its first in jack with a cord; its other wired inputs are secondary. */
const primaryIns = (m: Model) => {
  const out = new Map<string, string>()
  Object.values(m.P).forEach(p => { if (p.kind === 'module' && p.dir === 'in' && !out.has(p.owner) && m.wires.some(w => w.to === p.key)) out.set(p.owner, p.key) })
  return out
}

/** One chain string per route id. */
export function routeChains(m: Model): Record<string, string> {
  const P = m.P, primary = primaryIns(m)
  const secondary = (key: string) => P[key]!.kind === 'module' && primary.get(P[key]!.owner) !== key
  const chains: Record<string, string> = {}
  m.routes.forEach(r => {
    const rw = m.wires.filter(w => w.route === r.id)
    const outsOf = (n: Node) => (n.kind === 'module' ? rw.filter(w => P[w.from]!.owner === n.id) : rw.filter(w => w.from === (n as { key: string }).key))
    const targetOf = (w: Wire): Node => (P[w.to]!.kind === 'module' ? { kind: 'module', id: P[w.to]!.owner } : { kind: 'sink', key: w.to })
    const srcRoots: Node[] = [...new Set(rw.filter(w => P[w.from]!.kind !== 'module' && !secondary(w.to)).map(w => w.from))].map(key => ({ kind: 'src', key }))
    const modRoots: Node[] = [...new Set(rw.filter(w => P[w.from]!.kind === 'module').map(w => P[w.from]!.owner))].filter(id => !primary.has(id)).map(id => ({ kind: 'module', id }))
    const seen = new Set<string>()
    const walk = (n: Node): string => {
      if (n.kind === 'module') {
        if (seen.has(n.id)) return ownerLabel(m, n.id) + ' ↺'   // reached again: a cycle, or two cords into one input
        seen.add(n.id)
      }
      const label = n.kind === 'module' ? m.rack.find(x => x.id === n.id)!.title : portName(m, n.key)
      const nexts = n.kind === 'sink' ? [] : outsOf(n).filter(w => !secondary(w.to))
      if (nexts.length === 0) return label
      if (nexts.length === 1) return label + ' → ' + walk(targetOf(nexts[0]!))
      return label + ' → fork(' + nexts.map(w => walk(targetOf(w))).join(' | ') + ')'
    }
    chains[r.id] = srcRoots.concat(modRoots).map(walk).join('   ·   ')
  })
  return chains
}
