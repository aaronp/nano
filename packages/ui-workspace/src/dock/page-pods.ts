/**
 * What a page's pod panels show (ADR-0038). `pagePods(platform, id, quiet)` holds page `id`'s slots as the Platform last
 * opened them: `open()` is the one way they start (`platform.open`: each slot's first resolved pod got or created,
 * reused if running), called when the page's dock shows and again when its slots or their resolution change (by
 * dock/page-docks.ts); calls while one runs are one more after it. `add` gives a pick (or an explorer's pod) its `pod`
 * slot, the dock's own write; `remove` drops a slot as a change made elsewhere (its panel goes).
 * `podPanel(el, slot, h, pods)` shows slot `slot` in `el`: its pod's chosen view (`nano-sandboxed` for a non-host pod),
 * made again when its view or runtime changes, and "N matched" under it when a selector matched several; why it failed
 * to open (tried again on a later apply while its page shows); or "<slot>: not found" with a Remove button (focus
 * then goes to the dock's area), never deploying or starting it. The notes are `role="status"`.
 *
 *   dock.pods = pagePods(platform, 'workspace', quiet); dock.pods.open()
 *   const stop = podPanel(container.element, 'any', host, dock.pods)
 */
import { Coord, type AppDeployment } from '@pritzlaff/nano-core'
import type { Platform, Slot } from '@pritzlaff/nano-platform'
import { viewFor, type ViewTarget } from '@pritzlaff/nano-ui'
import type { Host } from '../host.ts'
import { applyPages } from '../lib/pages.ts'
import { showStatus } from '../lib/status.ts'
import '../sandbox/sandboxed-view.ts'

type Instance = ReturnType<typeof Platform.create>
type Opened = Awaited<ReturnType<Instance['open']>>[string]
type Slots = Record<string, Slot>

const away = (h: Host, pod: string) => (h.data().pods[pod]?.isolation ?? 'host') !== 'host'
/** A pod's view tag: its selector, else `nano-sandboxed` for a non-host pod, else its implementation's default. */
export const chosen = (h: Host, pod: string) => (away(h, pod) && !customElements.get(h.data().views?.[pod] ?? '') ? 'nano-sandboxed' : viewFor(pod, h.data(), h.defaults()))
/** The tags a pod's view can be. */
export const viewTags = (h: Host, pod: string, impl: string) =>
  [...new Set([away(h, pod) && 'nano-sandboxed', h.defaults()[impl], 'nano-pod-view'].filter((x): x is string => !!x))]

export type PagePods = ReturnType<typeof pagePods>

export function pagePods(platform: Instance, id: string, quiet: (f: () => void) => void) {
  let opened: Record<string, Opened> = {}, running = false, again = false
  const heard = new Set<() => void>()
  const open = (): void => {
    if (running) { again = true; return }
    running = true
    void platform.open(id).then(r => { opened = r; for (const fn of [...heard]) fn() })
      .catch((e: unknown) => showStatus(document, `The page's pods did not open: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => { running = false; if (again) { again = false; open() } })
  }
  /** Page `id` with `slots` rewritten by `f`; a refusal shown. */
  const write = (f: (slots: Slots) => Slots) => {
    const d = platform.document().doc, p = d.pages[id]
    const r = p && applyPages(platform, { pages: { ...d.pages, [id]: { ...p, slots: f(p.slots) } } })
    if (r && !r.ok) showStatus(document, r.fail.reason)
  }
  return {
    open,
    /** What slot `slot` showed when last opened, and how many pods it matches now. */
    get(slot: string): { opened?: Opened; matched: number } {
      const r = platform.resolve(id)[slot]
      return { opened: opened[slot], matched: r?.kind === 'pod' ? r.pods.length : 0 }
    },
    listen(fn: () => void): () => void { heard.add(fn); return () => { heard.delete(fn) } },
    /** The page's slot showing pod `pod` of runtime `runtime` (its implementation `d`'s): a `pod` slot added (the dock's own write) and opened, if none was; none if `d` does not place it there. */
    add(d: AppDeployment, runtime: string, pod: string): string | undefined {
      const impl = d.pods[pod]?.implementation, slots = platform.document().doc.pages[id]?.slots
      if (!impl || !slots || !d.runtimes[runtime]?.pods.includes(pod)) return undefined
      const at = Coord.pod(Coord.parse('implementation', impl), Coord.runtime(runtime), pod), text = String(at)
      const known = Object.entries(slots).find(([, s]) => s.kind === 'pod' && String(s.pod) === text)?.[0]
      if (known) return known
      let sid = pod
      for (let n = 2; Object.hasOwn(slots, sid); n++) sid = `${pod}-${n}`
      quiet(() => write(s => ({ ...s, [sid]: { kind: 'pod', pod: at } })))
      open()
      return sid
    },
    /** Drops slot `slot` from the page, as a change made elsewhere: its panel goes. */
    remove(slot: string): void { write(({ [slot]: _, ...rest }) => rest) },
  }
}

const note = (className: string, text: string) => Object.assign(document.createElement('p'), { className, textContent: text })
/** A note announced as it changes (`role="status"`). */
const said = (className: string, text: string) => { const p = note(className, text); p.setAttribute('role', 'status'); return p }

/** Shows slot `slot` of `pods` in `el` (see above); returns what stops it listening. */
export function podPanel(el: HTMLElement, slot: string, h: Host, pods: PagePods): () => void {
  let shown = ''
  const render = () => {
    const { opened: o, matched } = pods.get(slot)
    if (!o || ('kind' in o && o.kind === 'view')) return
    if ('fail' in o) { shown = ''; return el.replaceChildren(note('dock-fail', o.fail.reason)) }
    if ('kind' in o) {
      shown = ''
      const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'dock-remove', textContent: 'Remove' })
      remove.setAttribute('aria-label', `Remove slot ${slot}`)
      remove.addEventListener('click', () => {
        // its panel goes: focus to the dock's area, not lost to the body (once the dock, built again, is back)
        const dock = el.closest('workspace-dock')
        pods.remove(slot)
        setTimeout(() => { const area = dock?.querySelector<HTMLElement>(':scope > .dock-area'); if (area) { area.tabIndex = -1; area.focus() } })
      })
      return el.replaceChildren(said('dock-fail', `${slot}: not found`), remove)
    }
    const { runtime: { id: runtime }, pod } = o.pod
    if (!h.data().pods[pod]) return   // gone since it opened: the Platform's re-resolution opens the page again
    const tag = chosen(h, pod), key = `${tag} ${runtime} ${pod} ${matched}`
    // the target is set once: a new one on every apply would restart the view's listening
    if (key === shown) return
    shown = key
    const view = Object.assign(document.createElement(tag), { target: { app: h.app, registry: h.registry, runtime, pod } satisfies ViewTarget })
    el.replaceChildren(view, ...(matched > 1 ? [said('dock-matched', `${matched} matched`)] : []))
  }
  render()
  const off = [pods.listen(render), h.app.listen(e => {
    if (e.type !== 'applied') return
    const o = pods.get(slot).opened
    // a failure is tried again (placed, or let in, since) while its page shows; a hidden one is opened when it shows again
    if (o && 'fail' in o) { if (!el.closest<HTMLElement>('app-route')?.hidden) pods.open() } else render()
  })]
  return () => { for (const f of off) f() }
}
