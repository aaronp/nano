// Shared setup of the dock tests: registers happy-dom, the dock and the widgets, and `mount`s a dock with two palette
// widgets (`shown` places an element that knows its instance, `plain` does not), collecting its dock:focus events.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { afterEach } from 'bun:test'

export const { createBus, provideBus } = await import('../src/lib/bus.ts')
await import('../src/components/workspace-dock.ts')
await import('../src/widgets/widgets.ts')
export type Dock = HTMLElement & { addWidget(id: string): void; template: string; setTemplate(id: string): boolean; arrangement(): { root?: unknown; template?: { template: string; order: unknown[]; parked: unknown[] } }; windowStyle: string; setWindowStyle(s: string): void; save(): void; restore(): void; reset(): void }
export const tick = () => new Promise(r => setTimeout(r, 0))
// a placed element stand-in: it knows its instance once connected
customElements.define('x-shown', class extends HTMLElement { model?: string; connectedCallback() { this.model = 'inst-1' } })

afterEach(() => { document.body.innerHTML = ''; localStorage.clear() })

export const mount = async () => {
  const bus = createBus()
  const app = document.createElement('div')
  provideBus(app, bus)
  app.innerHTML = `<workspace-dock id="ws" storage-key="t.ws" open="">
    <template data-widget="shown" data-title="Shown"><x-shown></x-shown></template>
    <template data-widget="plain" data-title="Plain"><div>plain</div></template></workspace-dock>`
  document.body.append(app)
  const dock = app.querySelector('workspace-dock') as Dock
  const focus: unknown[] = []
  dock.addEventListener('dock:focus', (e) => focus.push((e as CustomEvent).detail))
  const panel = (i = 0) => dock.querySelectorAll<HTMLElement>('.dock-panel')[i]!
  const down = (el: Element) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  return { bus, dock, focus, panel, down }
}
