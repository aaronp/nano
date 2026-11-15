/**
 * The frame's entry (built to public/sandbox/boot.js, its shared imports bare for the frame's import map): takes the
 * port the host hands over on load, then serves its pod and renders the pod's view (the module's `views` default for
 * the implementation, else `nano-pod-view`), or answers a `probe` with the module described.
 */
import { createRegistry, type Provider } from '@pritzlaff/nano-core'
import { defineViews, viewFor, type ViewMap } from '@pritzlaff/nano-ui'
import { describeProvider } from './protocol.ts'
import { serve } from './serve.ts'

type Mod = { default: Provider; views: ViewMap }

const mods = new Map<string, Promise<Mod>>()
/** The provider module at `url`, imported once. */
function mod(url: string): Promise<Mod> {
  if (!mods.has(url)) mods.set(url, import(url).then((m: { default?: unknown; views?: ViewMap }) => {
    const p = m.default as Provider | undefined
    if (!p || typeof p.coord !== 'string' || !(p.implementations instanceof Map)) throw new Error(`${url} has no default Provider`)
    return { default: p, views: { ...m.views } }
  }))
  return mods.get(url)!
}

addEventListener('message', function once(e: MessageEvent) {
  if (e.source !== parent || !e.ports[0]) return
  removeEventListener('message', once)
  let built: Mod | undefined
  serve(e.ports[0], async (u, coord) => {
    const i = (built = await mod(u)).default.implementations.get(coord)
    if (!i) throw new Error(`${u} has no implementation ${coord}`)
    return i
  }, {
    probe: async u => { const m = await mod(u); return [describeProvider(m.default, m.views)] },
    render(coord, target) {
      const m = built!, registry = createRegistry()
      registry.add(m.default)
      defineViews()
      const tag = viewFor(target.pod, { pods: { [target.pod]: { implementation: coord, eager: true } }, runtimes: {} }, m.views)
      const el = document.createElement(tag) as HTMLElement & { target?: unknown }
      el.target = { ...target, registry }
      document.body.append(el)
    },
  })
})
