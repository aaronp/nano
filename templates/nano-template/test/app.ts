// A test helper: the template's own nano.json, assembled and running (the timer's interval shortened).
import { Application, assemble, createRegistry, type AppDeployment, type NanoResult } from '@pritzlaff/nano-core'
import template from '../src/index.ts'

export const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function open() {
  globalThis.localStorage?.clear()
  const registry = createRegistry()
  must(registry.add(template))
  const d: AppDeployment = await Bun.file(new URL('../nano.json', import.meta.url)).json()
  d.pods.timer!.config = { intervalMs: 10 }
  return { app: must(await Application.create(must(assemble(d, registry)), {})), registry }
}
