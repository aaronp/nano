/**
 * The Wiring page (#/wiring): <c-circuit> over the Application, and a switcher to the dock's own Connections view.
 * It remembers the last route shown that is a screen, so Wiring opens on that page, and Connections goes back to it.
 */
import { requestBus } from './lib/bus.ts'

type Dock = HTMLElement & { connections?(): void }
type Circuit = HTMLElement & { page: string | null }

/** `screens` says which routes are screens (the Application's `screens` ids). */
export function bootWiring(doc: Document, screens: () => Promise<{ id: string }[]>) {
  const circuit = doc.querySelector<Circuit>('c-circuit')
  const link = doc.querySelector<HTMLAnchorElement>('a[data-connections]')
  if (!circuit || !link) return
  let last: string | null = null, seq = 0, armed: string | null = null
  const arrive = async (path: string) => {
    if (path === '/wiring') { circuit.page = last; link.hidden = last === null; if (last) link.href = `#${last}`; return }
    const mine = ++seq
    const ids = await screens().catch(() => [])
    if (mine === seq && ids.some(s => s.id === path)) last = path   // a later arrival wins
  }
  requestBus(circuit).subscribe('route:changed', m => {
    const path = (m.payload as { path: string }).path
    const flip = armed === path ? path : null
    armed = null   // any route change spends the arm
    void arrive(path)
    if (flip) requestAnimationFrame(() => doc.querySelector<Dock>(`app-route[path="${flip}"] workspace-dock`)?.connections?.())   // after layout
  })
  const now = doc.querySelector('app-shell > app-route:not([hidden])')?.getAttribute('path')   // the shell may have routed already
  if (now) void arrive(now)
  // Connections: the link goes to that workspace; arm one flip of its dock for when the shell reports it shown
  link.addEventListener('click', e => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return   // a new tab/window is not this page's navigation
    armed = last
  })
}
