/** The drift case study: `form` declares `submit → store.put` but also calls `store.delete`; the observer flags it, Reconcile adds it. */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, port, type NanoResult } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from '../kv/contract.ts'
import kv from '../kv/memory.ts'
import { observeCalls } from '../../packages/ui-workspace/src/observed-calls.ts'
import drift, { FormDef } from './index.ts'

const KV = KeyValueStoreDef.api
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

test('submit\'s undeclared store.delete is flagged, and reconciled into the deployment', async () => {
  const registry = Registry.create()
  for (const p of [kv, drift]) must(registry.add(p))
  const app = must(await Application.create(must(AppDeployment.assemble(await Bun.file(new URL('./nano.json', import.meta.url)).json(), registry))))
  const o = observeCalls(app, registry)
  await app.runtime('example.drift.main').get(FormDef.api).submit('hi')
  const source = port(FormDef.api, FormDef.api.ops.submit)
  expect(o.calls()).toContainEqual(expect.objectContaining({ source, target: port(KV, KV.ops.put), declared: true, seen: true }))
  expect(o.calls()).toContainEqual(expect.objectContaining({ source, target: port(KV, KV.ops.delete), declared: false, seen: true }))
  const edge = o.reconciled().runtimes['example.drift.main']!.subscriptions.find(s => s.kind === 'call')!
  expect(edge.kind === 'call' && edge.ops).toEqual([
    { source, target: port(KV, KV.ops.put) }, { source, target: port(KV, KV.ops.delete) }])
})
