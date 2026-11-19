// Shared setup of the wires tests: a stand-in dock (1200×600) and a mounted <c-wires> over the host's app.
import './dom.ts'
import { type Wires } from '../../src/wires'
import { onStage } from '../../src/wires/filter'
import { k, setup, tick } from './setup.ts'

export const box = (el: HTMLElement, x: number, y: number, w: number, h: number) => {
  for (const [k, v] of Object.entries({ offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h })) Object.defineProperty(el, k, { value: v, configurable: true })
}

// the host's app, and a stand-in dock (1200×600) with panels for r and l (their views' targets name the pod), and a Notes panel
export async function mount() {
  const t = await setup()
  const el = document.createElement('c-wires') as Wires
  el.host = t.host
  const dock = document.createElement('div')
  dock.innerHTML = '<div class="bar"><button>⇄ Connections</button></div><div class="dock-panel"><x-r></x-r></div><div class="dock-panel"><x-l></x-l></div><div class="dock-panel"><textarea></textarea></div>'
  box(dock, 0, 0, 1200, 600)
  const ps = [...dock.querySelectorAll<HTMLElement>('.dock-panel')]
  ps.forEach((p, i) => box(p, i * 400, 0, 400, 300))
  Object.assign(dock.querySelector('x-r')!, { target: { pod: 'r' } })
  Object.assign(dock.querySelector('x-l')!, { target: { pod: 'l' } })
  el.append(dock)
  document.body.append(el)
  await el.updateComplete
  const settle = async () => { await tick(); await el.updateComplete }
  const root = el.shadowRoot!
  const flip = async () => {
    dock.querySelector('button')!.dispatchEvent(new CustomEvent('dock:connections', { bubbles: true, composed: true }))
    await settle()
    // happy-dom has no layout: the plate is drawn at 1:1 at the page origin
    const plate = root.querySelector('.plate-bg')
    if (plate) plate.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 600 }) as DOMRect
  }
  // where the jack is drawn: Show Connected lays out only what it shows
  const at = (key: string) => { const p = onStage(el).P[key] ?? el.model.P[key]!; return { clientX: p.x, clientY: p.y } }
  const pipes = () => t.host.data().runtimes['main']!.subscriptions
  const submit = (v: unknown) => (t.app.call('main', 'r') as unknown as { submit(v: unknown): Promise<unknown> }).submit(v)
  return { ...t, el, dock, root, settle, flip, at, pipes, submit }
}
