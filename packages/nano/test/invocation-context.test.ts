/** A handler's invocation context: its op (`callingOp`), and calls through it continue the invoking message's chain. */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Provider, Registry, provide, success, type AppEvent } from '../src/index.ts'

const Str = Type.String()
const Front = Interface.define('acme.Front', { send: Op.action(Str, Str) })
const Store = Interface.define('acme.Store', { save: Op.action(Str, Str) })
const Go = Interface.define('acme.Go', { go: Op.action(Str, Str) })
const tick = () => new Promise(r => setTimeout(r, 1))
let gate: Promise<unknown> = Promise.resolve()
let factoryOp: unknown = 'unset'

const registry = Registry.create()
registry.add(Provider.define('acme', [
  Implementation.define('acme/store', { provides: [Store], make: () => ({ async save(x: string) { return x } }) }),
  Implementation.define('acme/src', { provides: [Go], make: () => ({ async go(x: string) { return x } }) }),
  Implementation.define('acme/front', { provides: [Front], dependencies: { store: Store }, make: ctx => {
    factoryOp = ctx.callingOp
    return { async send(x: string, c) { await tick(); await gate; return c!.deps.store.save(x) } }
  } }),
  Implementation.define('acme/lazy', { provides: [Front], dependencies: { store: Store }, make: ({ deps }) => ({
    async send(x: string) { return deps.store.save(x) } }) }),
  Implementation.define('acme/op', { provides: [Front], make: () => [provide(Front, { send: async (_, c) => success(c!.callingOp!) })] }),
]))

const deployment = (front: string, edge = true): AppDeployment => ({
    pods: { front: { implementation: front, eager: false }, store: { implementation: 'acme/store', eager: false }, src: { implementation: 'acme/src', eager: false } },
    runtimes: { r: { pods: ['front', 'store', 'src'], subscriptions: [
      ...(edge ? [{ kind: 'call' as const, from: 'front', to: 'store' }] : []),
      { kind: 'pipe' as const, from: 'src', source: 'acme.Go/go', to: 'front', target: 'acme.Front/send' },
    ] } },
})

async function app(front: string) {
  const d = AppDeployment.assemble(deployment(front), registry)
  if (!d.ok) throw new Error(d.fail.reason)
  const a = await Application.create(d.value)
  if (!a.ok) throw new Error(a.fail.reason)
  const events: AppEvent[] = []
  a.value.runtime('r').listen(e => { events.push(e) })
  return { app: a.value, events }
}
const sent = (events: AppEvent[], port: string) => events.filter((e): e is Extract<AppEvent, { type: 'sent' }> => e.type === 'sent' && e.port === port)

test('concurrent: each save is caused by its own send', async () => {
  const { app: a, events } = await app('acme/front')
  const rs = await Promise.all([a.call('r', 'front').send('a'), a.call('r', 'front').send('b')])
  expect(rs.map(r => r.ok)).toEqual([true, true])
  const sends = sent(events, 'acme.Front/send'), saves = sent(events, 'acme.Store/save')
  expect(saves.length).toBe(2)
  for (const s of saves) {
    const cause = sends.find(x => x.id === s.cause)!
    expect(cause).toBeDefined()
    expect(s.correlation).toBe(cause.correlation)
  }
  expect(saves[0]!.cause).not.toBe(saves[1]!.cause)
})

test('ignored: a handler using the factory deps starts a new chain', async () => {
  const { app: a, events } = await app('acme/lazy')
  expect((await a.call('r', 'front').send('a')).ok).toBe(true)
  const [save] = sent(events, 'acme.Store/save')
  expect(save!.cause).toBeUndefined()
  expect(save!.correlation).toBe(save!.id)
})

test('callingOp: the port being handled; absent in the factory ctx', async () => {
  const { app: a } = await app('acme/op')
  expect(await a.call('r', 'front').send('a')).toEqual(success('acme.Front/send'))
  const b = await app('acme/front')
  await b.app.call('r', 'front').send('a')
  expect(factoryOp).toBeUndefined()
})

test('pipe: a call from a piped-into handler is caused by the pipe delivery', async () => {
  const { app: a, events } = await app('acme/front')
  await a.call('r', 'src').go('a')
  while (!events.some(e => e.type === 'delivered' && e.id === sent(events, 'acme.Store/save')[0]?.id)) await tick()
  const [pipe] = events.filter(e => e.type === 'sent' && e.kind === 'pipe') as Extract<AppEvent, { type: 'sent' }>[]
  const [save] = sent(events, 'acme.Store/save')
  expect(save!.cause).toBe(pipe!.id)
})

test('gone: a removed edge while the handler awaits is not-found', async () => {
  const { app: a } = await app('acme/front')
  let open!: () => void
  gate = new Promise<void>(r => { open = r })
  const p = a.call('r', 'front').send('a')
  await tick()
  expect((await a.apply(deployment('acme/front', false))).ok).toBe(true)
  open()
  const r = await p
  gate = Promise.resolve()
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.fail.type).toBe('not-found')
})
