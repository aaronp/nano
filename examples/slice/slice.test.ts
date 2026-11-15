/**
 * The slice example: `nano.json` assembles against `nano.ui` plus `example.slice`; an `apply` swaps `up` from the
 * upper-casing `nano.ui/map` to `example.slice/shout`, and a submitted `hi` is logged as `hi!`.
 */
import { expect, test } from 'bun:test'
import { Application, assemble, createRegistry, Pod, success, type AppDeployment, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider from '@pritzlaff/nano-ui'
import slice from './shout.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

test('given nano.json, when up is swapped to example.slice/shout, then submitting "hi" logs "hi!"', async () => {
  const registry = createRegistry()
  must(registry.add(uiProvider))
  must(registry.add(slice))
  const deployment: AppDeployment = await Bun.file(new URL('./nano.json', import.meta.url)).json()
  const app = must(await Application.create(must(assemble(deployment, registry)), {}))
  must(await app.apply({ ...deployment, pods: { ...deployment.pods, up: Pod.lazy(slice.implementations.get('example.slice/shout')!) } }))
  await app.call('main', 'in').submit('hi')
  await sleep(40)
  expect(await app.call('main', 'out').entries(null)).toEqual(success(['hi!']))
})
