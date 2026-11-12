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
  let last: string | null = null
  const arrive = async (path: string) => {
    if (path === '/wiring') { circuit.page = last; link.hidden = last === null; if (last) link.href = `#${last}`; return }
    if ((await screens()).some(s => s.id === path)) last = path
  }
  requestBus(circuit).subscribe('route:changed', m => void arrive((m.payload as { path: string }).path))
  const now = doc.querySelector('app-shell > app-route:not([hidden])')?.getAttribute('path')   // the shell may have routed already
  if (now) void arrive(now)
  // Connections: go to that workspace, then flip its dock once the shell has shown it
  link.addEventListener('click', () => {
    const path = last
    addEventListener('hashchange', () => setTimeout(() => doc.querySelector<Dock>(`app-route[path="${path}"] workspace-dock`)?.connections?.()), { once: true })
  })
}
