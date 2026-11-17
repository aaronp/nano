/**
 * What each dock panel holds: `explorer` and `wiring` nano-ui's elements, `stream` the app's events, `pod:<name>` the
 * pod's chosen view (`nano-sandboxed` for a non-host pod), made again when its view or runtime changes.
 *
 *   const dispose = fill(container.element, 'pod:up', host)
 */
import { viewFor, type ViewTarget } from '@pritzlaff/nano-ui'
import type { Host } from '../host.ts'
import '../sandbox/sandboxed-view.ts'

const away = (h: Host, pod: string) => (h.data().pods[pod]?.isolation ?? 'host') !== 'host'
/** A pod's view tag: its selector, else `nano-sandboxed` for a non-host pod, else its implementation's default. */
export const chosen = (h: Host, pod: string) => (away(h, pod) && !customElements.get(h.data().views?.[pod] ?? '') ? 'nano-sandboxed' : viewFor(pod, h.data(), h.defaults()))
/** The tags a pod's view can be. */
export const viewTags = (h: Host, pod: string, impl: string) =>
  [...new Set([away(h, pod) && 'nano-sandboxed', h.defaults()[impl], 'nano-pod-view'].filter((x): x is string => !!x))]

type Viewing = HTMLElement & { target?: unknown }
const made = (tag: string, target: unknown) => Object.assign(document.createElement(tag) as Viewing, { target })

/** Fills panel `id`'s element; returns what stops it listening. */
export function fill(el: HTMLElement, id: string, h: Host): () => void {
  const target = { app: h.app, registry: h.registry }
  if (id === 'explorer' || id === 'wiring') { el.append(made(`nano-${id}`, target)); return () => {} }
  if (id === 'stream') {
    const pre = el.appendChild(document.createElement('pre')), lines: string[] = []
    pre.className = 'dock-stream'
    return h.app.listen(e => { lines.push(JSON.stringify(e)); if (lines.length > 200) lines.shift(); pre.textContent = lines.join('\n') })   // the last 200
  }
  const pod = id.slice('pod:'.length)
  let shown = ''
  const show = () => {
    const d = h.data(), runtime = Object.keys(d.runtimes).find(r => d.runtimes[r]!.pods.includes(pod))
    if (!runtime) return
    const tag = chosen(h, pod), key = `${tag} ${runtime}`
    // the target is set once: a new one on every apply would restart the view's listening
    if (key !== shown) { shown = key; el.replaceChildren(made(tag, { ...target, runtime, pod } satisfies ViewTarget)) }
  }
  show()
  return h.app.listen(e => { if (e.type === 'applied') show() })
}

/** The config a built-in starts with, where it needs one. */
const starts: Record<string, unknown> = { 'nano.ui/map': { code: 'return x' } }

/**
 * A palette template per implementation the host can make (what composable.ts's catalog was): `data-implementation`
 * names it, `data-package` its provider unless it is nano.ui's. The dock makes a pod of it when such a panel opens.
 */
export function implementationTemplates(h: Host, doc: Document): HTMLTemplateElement[] {
  return h.registry.manifest().providers.filter(p => p.coord !== 'workspace.host').flatMap(p => p.implementations.map(coord => {
    const t = doc.createElement('template')
    t.dataset['widget'] = coord.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    t.dataset['title'] = coord.slice(coord.indexOf('/') + 1)
    t.dataset['catalog'] = ''
    t.dataset['implementation'] = coord
    if (p.coord !== 'nano.ui') { t.dataset['package'] = p.coord; t.dataset['packageUrl'] = h.data().modules?.[p.coord] ?? '' }
    return t
  }))
}

/** Adds a pod of `coord` to runtime main, named `<kind><n>` with the first free n; its name, once applied. */
export async function addPod(h: Host, coord: string): Promise<string | undefined> {
  const d = h.data(), kind = coord.slice(coord.indexOf('/') + 1)
  let n = 1
  while (`${kind}${n}` in d.pods) n++
  const name = `${kind}${n}`, pod = { implementation: coord, eager: true, ...(starts[coord] !== undefined && { config: starts[coord] }) }
  const main = d.runtimes['main'] ?? { pods: [], subscriptions: [] }
  const r = await h.apply({ ...d, pods: { ...d.pods, [name]: pod }, runtimes: { ...d.runtimes, main: { ...main, pods: [...main.pods, name] } } })
  return r.ok ? name : undefined
}
