/** The Typing example, its debounce quickened and left on real time (no call edge to its clock pod), for the recorder's tests. */
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider from '@pritzlaff/nano-ui'

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

export const log = (app: Application) => app.call('main', 'log').entries(null)
