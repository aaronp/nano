// Shared setup of the dock-on-its-page tests: the real host, the picker stubbed, and `mount`, the workspace's pages over
// the host core's live outline (Main's dock and one per other page, in hidden routes until `go` shows one, as app-shell does).
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: new URL('../../../', import.meta.url).href })
import { afterEach, expect, mock } from 'bun:test'
import { flat, liveOutline } from './flat.ts'
import { Coord } from '@pritzlaff/nano-core'
import type { Page, Slot } from '@pritzlaff/nano-outline'
import type { PanelState } from '../src/lib/layout-templates.ts'

export const pick: { choice: PanelState | null; runtime: string | undefined } = { choice: null, runtime: undefined }   // the picker, stubbed
mock.module('../src/components/picker.ts', () => ({ pick: async () => pick.choice && { state: pick.choice, runtime: pick.runtime } }))
export const seen: { entries?: { pods?(implementation: string, runtime: string): { name: string; running: boolean }[] } } = {}   // the entries the inline picker was last given
mock.module('../src/components/picker-grid.ts', () => ({ pickerGrid: (host: HTMLElement, entries: never) => new Promise(r => { seen.entries = entries; host.addEventListener('click', () => pick.choice && r({ state: pick.choice, runtime: pick.runtime })) }) }))   // inline: a click picks `choice`
const { defineViews } = await import('@pritzlaff/nano-ui')
const { start } = await import('../src/host.ts')
await import('../src/components/workspace-dock.ts')
export const { implementationTemplates } = await import('../src/dock/panels.ts')
const { createBus, provideBus } = await import('../src/lib/bus.ts')
const { bootWorkspacePages } = await import('../src/components/workspace-pages.ts')
defineViews()

export type H = Extract<Awaited<ReturnType<typeof start>>, { ok: true }>['value']
export type Dock = HTMLElement & { host?: H; setTemplate(id: string): boolean; template: string; save(): void; restore(): void; arrangement(): { template?: { order: ({ name?: string } | null)[] } } }
export const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise(r => setTimeout(r, 5)); expect(ok()).toBe(true) }
export const tick = (ms = 20) => new Promise(r => setTimeout(r, ms))
afterEach(() => { document.body.innerHTML = ''; pick.choice = null; pick.runtime = undefined })

export const host = async () => { const r = await start(); if (!r.ok) throw new Error(r.fail.reason); return r.value }
/** Places `pods` (lazy, of `impl`) in runtime `at`, made with `policy` if new: a stored document as a fresh host loads it. */
export const place = async (h: H, at: string, pods: string[], impl = 'nano.ui/input', policy?: unknown) => {
  const d = h.data(), rt = d.runtimes[at] ?? { pods: [], subscriptions: [], ...(policy !== undefined && { policy }) }
  const r = await h.apply({ ...d, pods: { ...d.pods, ...Object.fromEntries(pods.map(p => [p, { implementation: impl, eager: false }])) }, runtimes: { ...d.runtimes, [at]: { ...rt, pods: [...rt.pods, ...pods] } } } as never)
  if (!r.ok) throw new Error(r.fail.reason)
}
/** Removes pod `name` from the deployment. */
export const undeploy = async (h: H, name: string) => {
  const d = h.data(), { [name]: _, ...pods } = d.pods
  const r = await h.apply({ ...d, pods, runtimes: Object.fromEntries(Object.entries(d.runtimes).map(([k, r]) => [k, { ...r, pods: r.pods.filter(p => p !== name) }])) })
  if (!r.ok) throw new Error(r.fail.reason)
}
/** A `pod` slot for `name` in `runtime`. */
export const pod = (name: string, runtime = 'main', impl = 'nano.ui/input'): Slot => ({ kind: 'pod', pod: Coord.pod(Coord.parse('implementation', impl), Coord.runtime(runtime), name) })
export const page = (title: string, slots: Record<string, Slot> = {}): Page => ({ title, slots })
export const running = (h: H, name: string, runtime = 'main') => { const s = h.app.runtime(runtime).status(name); return s.ok && s.value === 'running' }
export const strs = (v: unknown) => JSON.parse(JSON.stringify(v ?? null))

/** The workspace's pages over `h`, from `pages` (Main is `workspace`, empty unless given). */
export function mount(h: H, pages: Record<string, Page>, open = '') {
  // a fresh live outline per mount, as a reload makes one (the host's own would keep the last mount's listeners)
  const outline = liveOutline(h.app, h.registry, flat({ workspace: page('Main', {}), ...pages })), bus = createBus(), app = document.createElement('div')
  provideBus(app, bus)
  app.innerHTML = `<span slot="title"></span><div class="nav-row" data-workspaces><a href="#/p/workspace"></a></div>
    <app-route path="/p/workspace" hidden><workspace-dock id="workspace" storage-key="main" open="${open}"><template data-widget="notes" data-title="Notes"><div>notes</div></template></workspace-dock></app-route>
    <app-route path="*" hidden></app-route>`
  const main = app.querySelector<Dock>('workspace-dock')!
  main.host = h
  main.prepend(...implementationTemplates(h, document))
  document.body.append(app)
  bootWorkspacePages(document, outline)
  const go = (id: string) => {
    for (const r of document.querySelectorAll<HTMLElement>('app-route')) r.hidden = r.getAttribute('path') !== `/p/${id}`
    bus.publish('route:changed', { path: `/p/${id}` }, 'test')
  }
  const dock = (id: string) => document.querySelector<Dock>(`app-route[path="/p/${id}"] workspace-dock`)!
  const panels = (id: string) => [...dock(id)?.querySelectorAll<HTMLElement>('.dock-panel') ?? []]   // none while a dock is built again
  /** Page `id`, written (coordinates as strings). */
  const written = (id: string) => strs(outline.document().doc.pages[id])
  /** Replaces page `id` (as a pod or an import would). */
  const put = (id: string, p: Page) => { const r = outline.apply(flat({ ...outline.document().doc.pages, [id]: p })); if (!r.ok) throw new Error(r.fail.reason) }
  return { outline, bus, go, dock, panels, written, put, input: implementationTemplates(h, document).find(t => t.dataset['implementation'] === 'nano.ui/input')!.dataset['widget']! }
}
export const starts = (h: H) => { const to: string[] = []; h.app.listen(e => { if (e.type === 'sent' && e.kind === 'start') to.push(e.to) }); return to }
/** Each getOrCreate's `started`, in order. */
export const opened = (h: H) => {
  const seen: boolean[] = [], runtime = h.app.runtime.bind(h.app)
  h.app.runtime = ((id: string) => { const v = runtime(id); return { ...v, getOrCreate: async (p: string) => { const r = await v.getOrCreate(p); if (r.ok) seen.push(r.value.started); return r } } }) as never
  return seen
}
