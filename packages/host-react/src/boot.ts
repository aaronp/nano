/**
 * Boot on the host core (`Host.boot`): nano.ui is this page's own provider; the stored document's other modules are
 * loaded only from this page's origin (another origin fails the boot, as before). The views: nano.ui's and each loaded
 * module's `views`.
 *
 *   const h = await boot(localStorage, { onStop })   // NanoResult<Host>
 */
import { failure, Registry } from '@pritzlaff/nano-core'
import uiProvider, { views as uiViews, type ViewMap } from '@pritzlaff/nano-ui'
import { Host } from '@pritzlaff/nano-host'

type Load = typeof Registry.load

/** `load`, refusing any module on another origin than `base`'s. */
const sameOrigin = (load: Load): Load => async (modules, base) => {
  const home = new URL(base).origin
  for (const [coord, ref] of Object.entries(modules)) {
    const url = new URL(ref, base)
    if (url.origin !== home) return failure('invalid-input', `${coord}: ${url.origin} is another origin, not loaded by this host`)
  }
  return load(modules, base)
}

export const boot = (storage: Storage, { load = Registry.load, base = globalThis.location.href, onStop }: { load?: Load; base?: string; onStop?: () => void } = {}) =>
  Host.boot(storage, { base, load: sameOrigin(load), providers: [uiProvider], ...(onStop && { onStop }) })

export const viewsOf = (h: Host): ViewMap => Object.assign({ ...uiViews }, ...Object.values(h.exports).map(m => (m['views'] ?? {}) as ViewMap))
