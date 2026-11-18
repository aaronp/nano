/** The drift case study: `form` declares `submit → store.put` but also calls `store.delete`; the observer flags it, Reconcile adds it. */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
import kv from '../kv/memory.ts'
import { observeCalls } from '../../packages/ui-workspace/src/observed-calls.ts'
import drift, { FormDef } from './index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

test('submit\'s undeclared store.delete is flagged, and reconciled into the deployment', async () => {
  const registry = Registry.create()
  for (const p of [kv, drift]) must(registry.add(p))
  const app = must(await Application.create(must(AppDeployment.assemble(await Bun.file(new URL('./nano.json', import.meta.url)).json(), registry))))
  const o = observeCalls(app, registry)
  await app.runtime('example.drift.main').get(FormDef.api).submit('hi')
  const source = 'example.drift.Form/submit'
  expect(o.calls()).toContainEqual(expect.objectContaining({ source, target: 'example.kv.KeyValueStore/put', declared: true, seen: true }))
  expect(o.calls()).toContainEqual(expect.objectContaining({ source, target: 'example.kv.KeyValueStore/delete', declared: false, seen: true }))
  const edge = o.reconciled().runtimes['example.drift.main']!.subscriptions.find(s => s.kind === 'call')!
  expect(edge.kind === 'call' && edge.ops).toEqual([
    { source, target: 'example.kv.KeyValueStore/put' }, { source, target: 'example.kv.KeyValueStore/delete' }])
})
