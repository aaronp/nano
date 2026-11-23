// A test helper: the template's own nano.json, assembled and running (the timer's interval shortened).
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import template from '../src/index.ts'

export const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** `bare`: no subscriptions, so no event is on the stream unless someone subscribes. */
// #region open
export async function open(bare = false) {
  globalThis.localStorage?.clear()
  const registry = Registry.create()
  must(registry.add(template))
  const d: AppDeployment = await Bun.file(new URL('../nano.json', import.meta.url)).json()
  d.pods.timer!.config = { intervalMs: 10 }
  if (bare) d.runtimes.main!.subscriptions = []
  return { app: must(await Application.create(must(AppDeployment.assemble(d, registry)), {})), registry }
}
// #endregion open
