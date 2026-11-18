/** A sandboxed pod's dependency calls from a handler continue that invocation's chain (`cause` = the invoking message). */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Provider, Registry, type AppEvent } from '@pritzlaff/nano-core'
import { edgesFor } from '../src/sandbox/edges.ts'
import { serve } from '../src/sandbox/serve.ts'
import { standIn, type Frame } from '../src/sandbox/stand-in.ts'

const Str = Type.String()
const Front = Interface.define('acme.Front', { send: Op.action(Str, Str) })
const Store = Interface.define('acme.Store', { save: Op.action(Str, Str) })
const tick = () => new Promise(r => setTimeout(r, 1))
const registry = Registry.create()
registry.add(Provider.define('acme', [
  Implementation.define('acme/store', { provides: [Store], make: () => ({ async save(x: string) { return x } }) }),
  Implementation.define('acme/front', { provides: [Front], dependencies: { store: Store }, make: () => ({
    async send(x: string, c) { await tick(); return c.deps.store.save(x) } }) }),
]))
const sent = (events: AppEvent[], port: string) => events.filter((e): e is Extract<AppEvent, { type: 'sent' }> => e.type === 'sent' && e.port === port)

test('given a sandboxed front, when send saves after an await, then the save is caused by the send', async () => {
  const d = AppDeployment.assemble({
    pods: { front: { implementation: 'acme/front', eager: false, isolation: 'sandbox' }, store: { implementation: 'acme/store', eager: false } },
    runtimes: { r: { pods: ['front', 'store'], subscriptions: [{ kind: 'call', from: 'front', to: 'store' }] } },
  }, registry)
  if (!d.ok) throw new Error(d.fail.reason)
  let app!: Application
  const deps = {
    url: 'mem:acme', app: () => app, onApplied: () => () => {}, warn: () => {},
    edges: (pod: string) => edgesFor(app.deployment(), registry, pod), implementation: (c: string) => registry.implementation(c),
    open(): Frame {
      const ch = new MessageChannel()
      serve(ch.port1, async (_, coord) => registry.implementation(coord)!)
      return { port: ch.port2, ready: Promise.resolve(), dispose() { ch.port1.close(); ch.port2.close() } }
    },
  }
  const made = await Application.create(d.value, { isolate: (_, pod) => standIn(registry.implementation(pod.implementation)!, deps) })
  if (!made.ok) throw new Error(made.fail.reason)
  app = made.value
  const events: AppEvent[] = []
  app.listen(e => { events.push(e) })
  expect(await app.call('r', 'front').send!('x')).toMatchObject({ ok: true, value: 'x' })
  const [send] = sent(events, 'acme.Front/send'), [save] = sent(events, 'acme.Store/save')
  expect(save!.cause).toBe(send!.id)
  expect(save!.correlation).toBe(send!.correlation)
  await app.close()
})
