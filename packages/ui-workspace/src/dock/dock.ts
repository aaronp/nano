/**
 * `<workspace-dock>`: the golden-layout dock over the host. Its panels (panels.ts) are dragged by their tabs, docked,
 * stacked, resized, maximised and closed; closing a pod's panel leaves the pod alone, and a pod that goes closes its
 * panel. Clicking a pod in the explorer, or dragging it out, opens (or focuses) `pod:<name>`. The arrangement is the
 * host's `layout` (layout.ts): Save layout writes it, and a new one (an opened nano.json's) is shown at once.
 * Light DOM, because golden-layout puts its drag proxy in document.body; its CSS is in app.css.
 *
 *   dock.host = host; dock.command('save-layout')   // or 'restore', 'reset', 'tabs', 'clear'
 */
import { GoldenLayout, LayoutConfig, type ComponentItem, type ContentItem, type RowOrColumn, type Stack } from 'golden-layout/dist/esm/index.js'   // golden-layout.d.ts
import { toast } from '@pritzlaff/nano-elements'
import type { Host } from '../host.ts'
import { defaultLayout, idOf, panel, panelIds, prune, type Layout } from './layout.ts'
import { fill } from './panels.ts'

/** The tab bar's height: app.css draws it, and golden-layout sizes panels for it. */
const HEADER_H = 30
const warn = (title: string) => void toast(title, { variant: 'warn' })

class WorkspaceDock extends HTMLElement {
  #host?: Host
  #gl?: GoldenLayout
  /** The host's layout as last shown or saved here, so only a new one is loaded. */
  #seen = ''
  /** The pod under the pointer when a drag from the explorer began. */
  #dragging = ''

  get host() { return this.#host }
  set host(h: Host | undefined) { this.#host = h; this.#build() }
  connectedCallback() { this.#build() }

  #build() {
    const h = this.#host
    if (!h || !this.isConnected || this.#gl) return
    const gl = this.#gl = new GoldenLayout(this)
    gl.resizeWithContainerAutomatically = true
    gl.registerComponentFactoryFunction('panel', (container, state) => {
      const id = idOf({ type: 'component', componentType: 'panel', componentState: state })
      if (!id) throw new Error(`no dock panel ${JSON.stringify(state)}`)
      container.element.classList.add('dock-panel')
      container.on('destroy', fill(container.element, id, h))
      if (id === 'explorer') this.#dragFrom(container.element, gl)
      return undefined
    })
    this.addEventListener('nano-open', e => this.open((e as CustomEvent<{ pod: string }>).detail.pod))
    h.app.listen(e => { if (e.type === 'applied') this.#applied() })
    this.#fromHost()
  }

  /** Pods with a view: the host's own pod is not one. */
  #pods() { return Object.keys(this.#host!.saved().pods) }

  #load(l: Layout) {
    const d = l.dock as Parameters<typeof LayoutConfig.isResolved>[0]
    const config = LayoutConfig.isResolved(d) ? LayoutConfig.fromResolved(d) : d
    this.#gl!.loadLayout({ ...config, dimensions: { ...config.dimensions, headerHeight: HEADER_H } })
  }

  /** Shows the host's layout, without the panels of pods that are gone; none: the default. */
  #fromHost() {
    const kept = this.#host!.data().layout
    this.#seen = JSON.stringify(kept)
    if (!kept) return this.#load(defaultLayout(this.#pods()))
    const { layout, dropped, invalid } = prune(kept, this.#pods())
    if (invalid) warn('The layout could not be read: the default is shown')
    else if (dropped.length) warn(`No pod ${dropped.map(d => d.slice(4)).join(', ')}: dropped from the layout`)
    this.#load(layout)
  }

  #applied() {
    if (JSON.stringify(this.#host!.data().layout) !== this.#seen) return this.#fromHost()
    const pods = this.#pods()
    for (const c of this.#panels()) if (c.id.startsWith('pod:') && !pods.includes(c.id.slice(4))) c.item.close()
  }

  /** Every open panel's item. */
  #panels(): { id: string; item: ComponentItem }[] {
    const walk = (it: ContentItem): { id: string; item: ComponentItem }[] => it.isComponent
      ? [{ id: idOf({ type: 'component', componentType: 'panel', componentState: (it as ComponentItem).container.state }) ?? '', item: it as ComponentItem }]
      : it.contentItems.flatMap(walk)
    return this.#gl?.rootItem ? walk(this.#gl.rootItem) : []
  }

  /** Focuses pod `name`'s panel, else opens it beside the other pods' views (else as the middle column). */
  open(name: string) {
    const gl = this.#gl, id = `pod:${name}`, at = this.#panels(), open = at.find(c => c.id === id)
    if (!gl) return
    if (open) { (open.item.parentItem as Stack).setActiveComponentItem(open.item, true); return }
    const p = panel(id), beside = at.find(c => c.id.startsWith('pod:'))?.item.parentItem
    if (beside?.isStack) (beside as Stack).addComponent('panel', p.componentState as never, p.title)
    else if (gl.rootItem?.isRow || gl.rootItem?.isColumn) (gl.rootItem as RowOrColumn).addItem({ type: 'stack', content: [p as never] }, 1)
    else gl.addComponent('panel', p.componentState as never, p.title)
  }

  /** The explorer drags out the pod row under the pointer; anywhere else in it, a press is not a drag. */
  #dragFrom(el: HTMLElement, gl: GoldenLayout) {
    el.addEventListener('pointerdown', e => {
      const row = e.composedPath().find((n): n is HTMLElement => n instanceof HTMLElement && /^p:/.test(n.dataset['id'] ?? ''))
      this.#dragging = row?.dataset['id']!.split(':').slice(2).join(':') ?? ''
      if (!row) e.stopPropagation()   // before golden-layout's listener on the explorer itself
    }, { capture: true })
    gl.newDragSource(el.firstElementChild as HTMLElement, () => ({ type: 'panel', state: { id: `pod:${this.#dragging}` }, title: this.#dragging }))
  }

  /** The View menu: 'save-layout' | 'restore' | 'reset' | 'tabs' (every panel in one stack) | 'clear' (no pod panels). */
  command(c: string) {
    const gl = this.#gl, h = this.#host
    if (!gl || !h) return
    const now: Layout = { dock: JSON.parse(JSON.stringify(gl.saveLayout())) }
    if (c === 'save-layout') {
      this.#seen = JSON.stringify(now)
      void h.apply({ ...h.data(), layout: now }).then(r => { if (r.ok) toast('Layout saved') })
    } else if (c === 'restore') {
      if (h.data().layout) this.#fromHost()
      else warn('No saved layout yet')
    } else if (c === 'reset') this.#load(defaultLayout(this.#pods()))
    else if (c === 'tabs') this.#load({ dock: { root: { type: 'stack', content: panelIds(now.dock.root).map(panel) }, header: { popout: false } } })
    else if (c === 'clear') this.#load(prune(now, []).layout)
  }
}

if (!customElements.get('workspace-dock')) customElements.define('workspace-dock', WorkspaceDock)
export type { WorkspaceDock }
