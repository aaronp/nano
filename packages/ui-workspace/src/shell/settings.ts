import type { Host } from '../host.ts'

/** Settings' button: forget this browser's pane sizes (the `split:*` keys) and the host's kept layout (the dock then
 * shows the default). */
export async function forgetLayout(storage: Storage = localStorage, host?: Host) {
  for (const k of Object.keys(storage).filter(k => k.startsWith('split:'))) storage.removeItem(k)
  const { layout, ...rest } = host?.data() ?? {}
  if (host && layout) await host.apply(rest as ReturnType<Host['data']>)
}
