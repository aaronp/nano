// Shared setup of the todo template tests: the saved nano.json and an application opened from it.
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from '../kv/contract.ts'
import kv from '../kv/memory.ts'
import todo from './todo/kv.ts'

export const KV = KeyValueStoreDef.api
export const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
export const saved = async (): Promise<AppDeployment> => Bun.file(new URL('./nano.json', import.meta.url)).json()

export async function open() {
  const registry = Registry.create()
  for (const p of [kv, todo]) must(registry.add(p))
  return must(await Application.create(must(AppDeployment.assemble(await saved(), registry))))
}
