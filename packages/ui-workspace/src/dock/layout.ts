/**
 * The dock's arrangement as data, `nano.json`'s `layout`: `{ dock: <golden-layout config> }`. A panel is a
 * golden-layout component of type `panel` whose state names it: `explorer`, `wiring`, `stream` or `pod:<name>`. Pure.
 *
 *   prune(host.data().layout, pods)   // { layout, dropped: ['pod:gone'] }; unreadable: the default, invalid: true
 */

/** A golden-layout item (resolved or not): a group (`row`, `column`, `stack`) or a `component`. */
export type Item = { type: string; content?: Item[]; componentType?: unknown; componentState?: unknown; title?: string; activeItemIndex?: number; [k: string]: unknown }
export type Layout = { dock: { root?: Item; [k: string]: unknown } }

const FIXED: Record<string, string> = { explorer: 'Explorer', wiring: 'Wiring', stream: 'Stream' }
const GROUPS = ['row', 'column', 'stack']
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** The panel id a component item names, if it is one of ours. */
export const idOf = (it: Item): string | undefined => {
  const id = obj(it.componentState) ? it.componentState['id'] : undefined
  return it.componentType === 'panel' && typeof id === 'string' && (id in FIXED || /^pod:./.test(id)) ? id : undefined
}

/** The component item for panel `id`, titled `Explorer` or the pod's name. */
export const panel = (id: string): Item =>
  ({ type: 'component', componentType: 'panel', componentState: { id }, title: FIXED[id] ?? id.slice('pod:'.length) })

/** Every panel id in a tree, in order. */
export const panelIds = (it: Item | undefined): string[] =>
  !it ? [] : it.type === 'component' ? [idOf(it) ?? ''] : (it.content ?? []).flatMap(panelIds)

/** Explorer on the left, the pods' views stacked in the middle, wiring and stream stacked on the right. */
export function defaultLayout(pods: string[]): Layout {
  const stack = (ids: string[], size: string): Item => ({ type: 'stack', size, content: ids.map(panel) })
  const middle = pods.length ? [stack(pods.map(p => `pod:${p}`), '50%')] : []
  return { dock: { root: { type: 'row', content: [stack(['explorer'], '20%'), ...middle, stack(['wiring', 'stream'], '30%')] }, header: { popout: false } } }
}

/** Whether `it` is a tree of our panels. */
const readable = (it: unknown): it is Item => obj(it) && (it['type'] === 'component' ? !!idOf(it as Item)
  : GROUPS.includes(it['type'] as string) && Array.isArray(it['content']) && it['content'].every(readable))

/** `layout` without the panels of pods not in `pods` (and the groups they leave empty). Anything that is not a layout
 * gives the default, `invalid`. */
export function prune(layout: unknown, pods: string[]): { layout: Layout; dropped: string[]; invalid?: true } {
  const dock = obj(layout) ? layout['dock'] : undefined
  if (!obj(dock) || (dock['root'] !== undefined && !readable(dock['root']))) return { layout: defaultLayout(pods), dropped: [], invalid: true }
  const dropped: string[] = []
  const keep = (it: Item): Item | undefined => {
    if (it.type === 'component') {
      const id = idOf(it)!
      if (!id.startsWith('pod:') || pods.includes(id.slice(4))) return { title: panel(id).title, ...it }   // golden-layout titles one without by its type
      dropped.push(id)
      return undefined
    }
    const kept = it.content!.map((c, i) => [keep(c), i] as const).filter((k): k is [Item, number] => !!k[0])
    if (!kept.length) return undefined
    const out: Item = { ...it, content: kept.map(k => k[0]) }
    if (typeof it.activeItemIndex === 'number') {   // the same tab, else the one before it
      const at = kept.findIndex(k => k[1] >= it.activeItemIndex!)
      out.activeItemIndex = at < 0 ? kept.length - 1 : kept[at]![1] === it.activeItemIndex ? at : Math.max(0, at - 1)
    }
    return out
  }
  const root = dock['root'] === undefined ? undefined : keep(dock['root'] as Item)
  const { root: _, ...rest } = dock
  return { layout: { dock: root ? { ...rest, root } : rest }, dropped }
}
