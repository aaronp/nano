/** The shared filter's value and its pure rules: what matches, which tree nodes stay, and each pod's status. */
import type { AppEvent } from '@pritzlaff/nano-core'
import type { TreeNode } from '@pritzlaff/nano-elements'
import { namespaces } from '../explorer-nodes.ts'

export type PodStatus = 'running' | 'not started' | 'stopped' | 'failed'
export type FilterValue = { text: string; kinds: Set<string>; namespaces: Set<string>; statuses: Set<PodStatus> }
export type FilterItem = { label: string; kind?: string; ns?: string; status?: PodStatus; terms?: string[] }

export const emptyFilter = (): FilterValue => ({ text: '', kinds: new Set(), namespaces: new Set(), statuses: new Set() })

/** An empty group is any. Selected namespaces absent from `known.namespaces` are ignored; an item with no status fails a status filter. */
export function matches(item: FilterItem, f: FilterValue, known?: { namespaces?: Set<string> }): boolean {
  const q = f.text.toLowerCase()
  const ns = known?.namespaces ? [...f.namespaces].filter(n => known.namespaces!.has(n)) : [...f.namespaces]
  return (!q || [item.label, ...(item.terms ?? [])].some(s => s.toLowerCase().includes(q)))
    && (!f.kinds.size || (!!item.kind && f.kinds.has(item.kind)))
    && (!ns.length || (!!item.ns && ns.includes(item.ns)))
    && (!f.statuses.size || (!!item.status && f.statuses.has(item.status)))
}

/** `nodes` with what matches (by `kind`, `data.ns`, `data.status`) and the way to it; a kept node keeps its children.
 * Groups (no kind) are kept when something under them is, and recounted. */
export function filterTree(nodes: TreeNode[], f: FilterValue): TreeNode[] {
  const known = { namespaces: new Set(namespaces(nodes)) }
  const walk = (list: TreeNode[]): TreeNode[] => list.flatMap(n => {
    const item: FilterItem = { label: n.label, kind: n.kind, ns: n.data?.ns, status: n.data?.status as PodStatus | undefined, terms: n.terms }
    if (n.kind && matches(item, f, known)) return [n]
    const kids = walk(n.children ?? [])
    return kids.length ? [{ ...n, children: kids, body: undefined, ...(n.count !== undefined && !n.kind && { count: kids.length }) }] : []
  })
  return walk(nodes)
}

const to: Partial<Record<AppEvent['type'], PodStatus>> = { built: 'running', restarted: 'running', closed: 'stopped', failure: 'failed' }

/** Folds one event into each pod's status; `applied` drops pods no longer `placed()`. A pod with no entry is not started. */
export function podStatus(states: Record<string, PodStatus>, e: AppEvent, placed: () => Set<string>): Record<string, PodStatus> {
  if (e.type === 'applied') { const p = placed(); return Object.fromEntries(Object.entries(states).filter(([k]) => p.has(k))) }
  const s = to[e.type]
  return s && 'pod' in e && e.pod ? { ...states, [e.pod]: s } : states
}
