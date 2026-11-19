/**
 * The Desk, Messages and Ring pages (#/desk, #/messages, #/ring), `hand`, which hands them and every time bar the
 * page's time machine and recording, and their switcher to the dock's own Connections view: it remembers the last route shown that is
 * a screen, so Connections goes back to it and flips that dock.
 */
import type { MessageStore, TimeMachine } from '@pritzlaff/nano-ui'
import { requestBus } from './lib/bus.ts'

type Dock = HTMLElement & { connections?(): void }

/** `screens` says which routes are screens (the Application's `screens` ids). */
export function bootWiring(doc: Document, screens: () => Promise<{ id: string }[]>) {
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[data-connections]')]
  if (!links.length) return
  let last: string | null = null, seq = 0, armed: string | null = null
  const arrive = async (path: string) => {
    if (path === '/desk' || path === '/messages' || path === '/ring') {   // the wiring pages are not screens
      for (const link of links) { link.hidden = last === null; if (last) link.href = `#${last}` }
      return
    }
    const mine = ++seq
    const ids = await screens().catch(() => [])
    if (mine === seq && ids.some(s => s.id === path)) last = path   // a later arrival wins
  }
  requestBus(links[0]!).subscribe('route:changed', m => {
    const path = (m.payload as { path: string }).path
    const flip = armed === path ? path : null
    armed = null   // any route change spends the arm
    void arrive(path)
    if (flip) requestAnimationFrame(() => {   // after layout; connections() toggles, so never on an already-flipped dock
      if ((doc.querySelector(`app-route[path="${flip}"] c-wires`) as { flipped?: boolean } | null)?.flipped) return
      doc.querySelector<Dock>(`app-route[path="${flip}"] workspace-dock`)?.connections?.()
    })
  })
  const now = doc.querySelector('app-shell > app-route:not([hidden])')?.getAttribute('path')   // the shell may have routed already
  if (now) void arrive(now)
  // Connections: the link goes to that workspace; arm one flip of its dock for when the shell reports it shown
  for (const link of links) link.addEventListener('click', e => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return   // a new tab/window is not this page's navigation
    armed = last
  })
}

/** The page's time machine and recording to each Desk, Messages table, time bar (with `driver`) and Ring (with `ring`:
 * its app, registry, shadow factory and filter). */
export function hand(doc: Document, page: { tm: TimeMachine; store: MessageStore; driver: unknown }, ring: Record<string, unknown>) {
  const { tm, store, driver } = page
  for (const el of doc.querySelectorAll('c-desk, c-messages')) Object.assign(el, { tm, store })
  for (const el of doc.querySelectorAll('nano-time-machine')) Object.assign(el, { tm, store, driver })
  for (const el of doc.querySelectorAll('nano-ring')) Object.assign(el, { tm, store, ...ring })
}
