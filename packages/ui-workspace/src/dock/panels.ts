/**
 * What each dock panel holds: `explorer` and `wiring` nano-ui's elements, `stream` the app's events, `pod:<name>` the
 * pod's chosen view (`nano-sandboxed` for a non-host pod), made again when its view or runtime changes.
 *
 *   const dispose = fill(container.element, 'pod:up', host)
 *   mountPanel(container, state, { doc, defs, bus, host, registry, send })   // golden-layout's factory for a panel
 */
import type { ComponentContainer, ComponentItem, ContentItem, JsonValue } from 'golden-layout/dist/esm/index.js'
import { viewFor, type ViewTarget } from '@pritzlaff/nano-ui'
import type { Host } from '../host.ts'
import { connected } from '../auto-connect.ts'
import { icon as explorerIcon } from '../icons.ts'
import { provideBus, type Bus } from '../lib/bus.ts'
import { panelContent, withMode } from '../lib/panel-content.ts'
import { panelState, readWidgetId, readWidgetMode, readWidgetName, shownInstance } from '../lib/dock-layout.ts'
import type { Def } from './palette.ts'
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
  const r = await h.apply(connected({ ...d, pods: { ...d.pods, [name]: pod }, runtimes: { ...d.runtimes, main: { ...main, pods: [...main.pods, name] } } }, h.registry, [name]))
  return r.ok ? name : undefined
}

type Mounting = { doc: Document; defs: ReadonlyMap<string, Def>; bus: Bus; host?: Host; registry?: unknown; send(topic: string, payload: unknown): void }

/** Fills a dock panel with its palette widget (state names it): the template's content, a pod's view, or a new pod of
 * an implementation; the panel's state then names the instance it shows, so Reset and Restore reattach. */
export function mountPanel(container: ComponentContainer, state: JsonValue | undefined, { doc, defs, bus, host: h, registry, send }: Mounting) {
  const id = readWidgetId(state)
  const def = defs.get(id)
  if (!def) throw new Error(`layout refers to unknown workspace widget "${id}"`)
  container.element.classList.add('dock-panel')
  if (def.template.hasAttribute('data-flush')) container.element.classList.add('flush')
  /* golden-layout may build a panel inside its drag proxy (in document.body), so each panel provides the bus itself */
  provideBus(container.element, bus)
  // upgraded at once, with placed elements in the dock's system (if it has one)
  const name = readWidgetName(state)
  // the saved mode (BACKLOG(2): an instance's own `nano/deploy` label is gone with the registry)
  const mode = readWidgetMode(state)
  const content = withMode(panelContent(doc, def.template, registry), id, mode, name)
  // a pod's or an implementation's panel shows its pod by name: kept in its state even with no host yet to show it
  const impl = def.template.dataset['implementation']
  const shown = (id === 'pod' || impl ? { name } : content.firstElementChild) as (Element & { model?: unknown }) | null
  if (name && id !== 'pod' && !impl) (shown as Element | null)?.setAttribute('name', name)   // before it connects, so it attaches to that instance
  container.element.append(content)
  if (h) for (const el of container.element.querySelectorAll<HTMLElement & { target?: unknown; icon?: unknown }>('nano-explorer, nano-wiring')) {
    if (el.localName === 'nano-explorer') el.icon = explorerIcon
    el.target = { app: h.app, registry: h.registry, get calls() { return h.calls() } }
  }
  if (h && id === 'pod' && name) container.on('destroy', fill(container.element, `pod:${name}`, h))
  // an implementation's panel makes a pod of it (or shows the one it made), as a catalog kind's placed a new instance
  if (h && impl) {
    let stop = () => {}, gone = false, pod = name
    const show = (p: string) => { pod = p; if (!gone) stop = fill(container.element, `pod:${p}`, h) }
    // once named, its state changed: a template position stores it (golden-layout reads it as it saves)
    if (name) show(name); else void addPod(h, impl).then((p) => { if (p) { show(p); if (!gone) container.emit('stateChanged') } })
    container.stateRequestEvent = () => ({ widget: id, ...(pod && { name: pod }) })
    container.on('destroy', () => { gone = true; stop() })
    send('dock:opened', { widget: id })
    return
  }
  for (const type of ['pointerdown', 'focusin']) container.element.addEventListener(type, () => container.focus())
  // saved layouts name the instance each panel shows, so Reset and Restore reattach instead of making new ones
  container.stateRequestEvent = () => panelState(id, shown)
  send('dock:opened', { widget: id })
}

/** The pod a `pod` panel, or an implementation's, shows. */
function podOf(item: ComponentItem, defs: ReadonlyMap<string, Def>): string | undefined {
  const state = item.container.stateRequestEvent?.() ?? item.container.initialState, def = defs.get(readWidgetId(state))
  return def && (def.id === 'pod' || def.template.dataset['implementation']) ? readWidgetName(state) : undefined
}
/** The instance a panel shows: its pod, else its placed element's instance, if any. */
export const shows = (item: ComponentItem, defs: ReadonlyMap<string, Def>) => podOf(item, defs) ?? shownInstance(item.container.element.firstElementChild as never)
/** The panel under `item` showing `pod`, if any. */
export const panelOf = (item: ContentItem | undefined, pod: string, defs: ReadonlyMap<string, Def>): ComponentItem | undefined => !item ? undefined
  : item.isComponent ? (podOf(item as ComponentItem, defs) === pod ? item as ComponentItem : undefined)
  : item.contentItems.map(i => panelOf(i, pod, defs)).find(Boolean)
