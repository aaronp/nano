/** The shared filter's value and its pure rules: what matches, which tree nodes stay. */
import type { PodStatus } from '@pritzlaff/nano-core'
import type { TreeNode } from '@pritzlaff/nano-elements'
import { namespaces } from '../explorer-nodes.ts'

export type { PodStatus }
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
