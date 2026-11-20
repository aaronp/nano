/**
 * The app bar on the page: <nano-app-bar> shows the shown page's controls (a workspace's controls, or nothing) and,
 * after them while a pod's panel is focused (or a pod was just opened from the explorer), that pod's: its view and its
 * implementation. A page change drops the pod's.
 *
 * On nano-core 0.4 (BACKLOG(5)): the app gateway is gone, so this hands the bar its element; a pod's controls are the
 * host's (the View and Change implementation pickers), each change an `apply` through the host.
 */
import { html, render } from 'lit'
import type { Host } from './host.ts'
import { connected } from './auto-connect.ts'
import { defineAppBar, type AppBarEl } from './components/app-bar.ts'
import { defineWorkspaceControls } from './components/workspace-controls.ts'
import { chosen, viewTags } from './dock/page-pods.ts'
import { requestBus } from './lib/bus.ts'

const value = (e: Event) => (e.target as HTMLElement & { value: string }).value

/** The shown page's default controls: its dock's, or none. */
function pageControls(route: Element | null): Element | null {
  const dock = route?.querySelector('workspace-dock')
  if (!dock) return null
  const el = document.createElement('nano-workspace-controls')
  el.setAttribute('dock', dock.id)
  return el
}

/** A pod's controls: its view and its implementation (those providing the same interfaces). */
function podControls(h: Host, pod: string): Element {
  const el = document.createElement('span')
  el.className = 'pod-controls'
  el.style.cssText = 'display:flex;align-items:center;gap:8px;padding-left:12px;border-left:1px solid color-mix(in srgb, currentColor 25%, transparent)'
  const swap = (coord: string) => {
    const d = h.data(), p = d.pods[pod]!, keeps = h.registry.implementation(coord)?.config?.check(p.config)
    return h.apply(connected({ ...d, pods: { ...d.pods, [pod]: { implementation: coord, eager: p.eager, ...(keeps && { config: p.config }) } } }, h.registry, [pod]))
  }
  const draw = () => {
    const d = h.data(), p = d.pods[pod]
    if (!p) return render(html``, el)
    const same = (a: readonly string[]) => [...a].sort().join()
    const mine = same(h.registry.implementation(p.implementation)?.provides.map(i => i.coord) ?? [])
    const impls = h.registry.manifest().implementations.filter(i => same(i.provides) === mine).map(i => i.coord)
    render(html`<b>${pod}</b>
      <small>View</small><nano-select label="View" .options=${viewTags(h, pod, p.implementation)} .value=${chosen(h, pod)}
        @change=${(e: Event) => h.apply({ ...d, views: { ...d.views, [pod]: value(e) } })}></nano-select>
      <small>Implementation</small><nano-select label="Change implementation" .options=${impls} .value=${p.implementation}
        @change=${(e: Event) => swap(value(e))}></nano-select>`, el)
  }
  draw()
  const off = h.app.listen(e => { if (e.type === 'applied') { if (el.isConnected) draw(); else off() } })
  return el
}

export function bootAppBar(h: Host) {
  defineAppBar()
  defineWorkspaceControls()
  const bar = document.querySelector<AppBarEl>('nano-app-bar')
  if (!bar) return
  let page = pageControls(document.querySelector('app-shell > app-route:not([hidden])')), focused: Element | null = null
  const draw = () => {
    const both = document.createElement('span')
    both.style.display = 'contents'   // its children are the bar's own flex items
    both.append(...[page, focused].filter(e => e !== null))
    bar.show(both)
  }
  requestBus(bar).subscribe('route:changed', m => {
    page = pageControls(document.querySelector(`app-shell > app-route[path="${(m.payload as { path: string }).path}"]`))
    focused = null
    draw()
  })
  draw()   // the page shown now, if the shell routed already
  const pod = (name: string | undefined) => { focused = name && h.data().pods[name] ? podControls(h, name) : null; draw() }
  document.addEventListener('dock:focus', e => pod((e as CustomEvent<{ instance: string } | null>).detail?.instance))
  document.addEventListener('nano-open', e => pod((e as CustomEvent<{ pod: string }>).detail.pod))
}
