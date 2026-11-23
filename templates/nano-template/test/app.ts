// A test helper: the template's own nano.json, assembled and running.
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import template from '../src/index.ts'

export const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

/** `config`: the calculator pod's config, if any. */
// #region open
export async function open(config?: { precision?: number }, file = new URL('../nano.json', import.meta.url)) {
  globalThis.localStorage?.clear()
  const registry = Registry.create()
  must(registry.add(template))
  const f = await Bun.file(file).json()
  const d: AppDeployment = f.app ?? f   // a file the nano-app saved is a host document: { app, outline, host }
  if (config) d.pods.calculator!.config = config
  return { app: must(await Application.create(must(AppDeployment.assemble(d, registry)), {})), registry }
}
// #endregion open
