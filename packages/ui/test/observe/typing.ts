/** The Typing example, its debounce quickened and left on real time (no call edge to its clock pod), for the recorder's tests. */
import { Application, AppDeployment, Registry, type NanoResult, type Provider } from '@pritzlaff/nano-core'
import uiProvider from '../../src/index.ts'

export const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/** One macrotask: lets pipes already sent be delivered. */
export const settle = () => sleep(0)

export async function typing(): Promise<Application> {
  const file: AppDeployment = await Bun.file(new URL('../../../../examples/typing/nano.json', import.meta.url)).json()
  const registry = Registry.create()
  must(registry.add(uiProvider))
  const main = file.runtimes['main']!
  const quick = { ...file, runtimes: { main: { ...main, subscriptions: main.subscriptions.filter(s => s.kind !== 'call') } }, pods: { ...file.pods, debounce: { ...file.pods['debounce']!, config: { quietMs: 20, maxWaitMs: 200 } } } }
  return must(await Application.create(must(AppDeployment.assemble(quick, registry)), {}))
}

/**
 * Typing on a simulated clock: its `clock` pod is `nano.ui/sim-clock`, wired to the debounce (quiet 1000 ms, max wait
 * 4000 ms), so time moves only by `app.call('main', 'clock').advance(ms)`. `log` and `provider` swap in a log pod.
 */
export async function typingSim(opts: { log?: string; provider?: Provider; timeoutMs?: number } = {}): Promise<Application> {
  const file: AppDeployment = await Bun.file(new URL('../../../../examples/typing/nano.json', import.meta.url)).json()
  const registry = Registry.create()
  must(registry.add(uiProvider))
  if (opts.provider) must(registry.add(opts.provider))
  const pods = { ...file.pods, clock: { ...file.pods['clock']!, implementation: 'nano.ui/sim-clock' }, ...(opts.log ? { log: { ...file.pods['log']!, implementation: opts.log } } : {}) }
  return must(await Application.create(must(AppDeployment.assemble({ ...file, pods }, registry)), { timeoutMs: opts.timeoutMs }))
}

export const log = (app: Application) => app.call('main', 'log').entries(null)
