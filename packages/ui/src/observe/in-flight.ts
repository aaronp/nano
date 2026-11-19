import type { Application } from '@pritzlaff/nano-core'

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
/** How long one wait for quiet may take: core's default call timeout plus 1 s. ponytail: fixed, as the app doesn't say its `timeoutMs`; read it if it ever does. */
const QUIET_MS = 31_000

/**
 * Counts `app`'s messages in flight: each `sent` heard until its `delivered` or `denied` (an outcome of a message sent
 * before it listened is ignored: nothing waits on it). `quiet()` resolves once none is, one macrotask later and still
 * none (true), or after `QUIET_MS` from that call (false). `stop()` stops listening.
 */
export function inFlight(app: Application) {
  const open = new Set<string>()
  let wake = () => {}
  const stop = app.listen(e => {
    if (e.type === 'sent') open.add(e.id)
    else if ((e.type === 'delivered' || e.type === 'denied') && open.delete(e.id) && !open.size) wake()
  })
  const quiet = async () => {
    const end = Date.now() + QUIET_MS
    for (;;) {
      while (open.size) {
        if (Date.now() >= end) return false
        let timer: ReturnType<typeof setTimeout> | undefined
        await new Promise<void>(r => { wake = r; timer = setTimeout(r, end - Date.now()) })
        clearTimeout(timer)
      }
      await wait(0)
      if (!open.size) return true
    }
  }
  return { quiet, stop }
}
