// The spike's four-layer "save a person" (spikes/layers), on real registries and runtimes: needs bound by hand.
import { expect, test } from 'bun:test'
import { Type, type Static, type TSchema } from 'typebox'
import { Value } from 'typebox/value'
import { Components, define, iface, isOk, Ops, Registries, Runtimes, type Component, type Result, type Runtime } from '../src'

const Outcome = <T extends TSchema>(value: T) => Type.Union([
  Type.Object({ ok: Type.Literal(true), value }),
  Type.Object({ ok: Type.Literal(false), reason: Type.String() }),
])
type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string }
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value }), no = (reason: string) => ({ ok: false as const, reason })

const Person = Type.Object({ name: Type.String(), email: Type.String(), postcode: Type.String() })
const Stored = Type.Object({ id: Type.String(), person: Person })
type Person = Static<typeof Person>
type Stored = Static<typeof Stored>

const Db = iface('example/db', {
  save: { in: Type.Object({ key: Type.String(), value: Type.Unknown() }), out: Outcome(Type.String()) },
  load: { in: Type.String(), out: Type.Unknown() },
  keys: { in: Type.Null(), out: Type.Array(Type.String()) },
})
const MemoryDb = define('example/memory-db', Db, {}, () => {
  const m = new Map<string, unknown>()
  return {
    save: ({ key, value }) => { m.set(key, structuredClone(value)); return ok(key) },
    load: key => structuredClone(m.get(key) ?? null),
    keys: () => [...m.keys()],
  }
})
const ReadOnlyDb = define('example/read-only-db', Db, {}, () => ({ save: () => no('read only'), load: () => null, keys: () => [] }))

const Validation = iface('example/person-validation', { check: { in: Type.Unknown(), out: Outcome(Person) } })
const PersonRules = define('example/person-rules', Validation, {}, () => ({
  check: (x: unknown) => {
    if (!Value.Check(Person, x)) return no('name, email and postcode are required')
    const p = x as Person
    if (!p.name.trim()) return no('name is empty')
    if (!/^[^@\s]+@[^@\s]+$/.test(p.email)) return no('email looks wrong')
    if (!/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(p.postcode)) return no('postcode looks wrong')
    return ok({ name: p.name.trim(), email: p.email, postcode: p.postcode.toUpperCase() })
  },
}))

const PersonApi = iface('example/person-api', {
  create: { in: Person, out: Outcome(Type.String()) },
  get: { in: Type.String(), out: Type.Union([Stored, Type.Null()]) },
  list: { in: Type.Null(), out: Type.Array(Stored) },
})
const PersonService = define('example/person-service', PersonApi, { db: Db, rules: Validation }, ({ db, rules }) => {
  const get = async (id: string) => { const p = await db.load(id); return p ? { id, person: p as Person } : null }
  return {
    async create(p) {
      const checked = await rules.check(p)
      if (!checked.ok) return checked
      const saved = await db.save({ key: `person-${crypto.randomUUID().slice(0, 8)}`, value: checked.value })
      return saved.ok ? saved : no(`couldn't save: ${saved.reason}`)
    },
    get,
    async list() { return (await Promise.all((await db.keys(null)).map(get))).filter((x): x is Stored => !!x) },
  }
})

const Bff = iface('example/bff', {
  save: { in: Person, out: Outcome(Type.String()) },
  listPersons: { in: Type.Null(), out: Type.Array(Stored) },
  lookup: { in: Type.String(), out: Outcome(Type.String()) },
})
const WebBff = define('example/web-bff', Bff, { persons: PersonApi }, ({ persons }) => ({
  save: p => persons.create(p),
  listPersons: () => persons.list(null),
  async lookup(name) {
    const hit = (await persons.list(null)).find(s => s.person.name.toLowerCase() === name.trim().toLowerCase())
    return hit ? ok(hit.id) : no(`no one called ${name}`)
  },
}))

const Form = iface('example/person-form', {
  submit: { in: Type.Unknown(), out: Outcome(Type.String()) },
  lookup: { in: Type.String(), out: Outcome(Type.String()) },
  people: { in: Type.Null(), out: Type.Array(Stored) },
})
const PersonForm = define('example/person-form', Form, { bff: Bff, rules: Validation }, ({ bff, rules }) => ({
  async submit(input) {
    const checked = await rules.check(input)
    return checked.ok ? bff.save(checked.value) : checked
  },
  lookup: name => bff.lookup(name),
  people: () => bff.listPersons(null),
}))

const ui = { registry: 'ui', instance: 'page' }
const must = <T>(r: Result<T>): T => { if (!isOk(r)) throw new Error(r.error); return r.value }

/** Four runtimes that find each other by registry id; each provider added, then each need bound by hand. */
function build(opts: { bindFormBff?: boolean } = {}) {
  const rts = new Map<string, Runtime>(), peers = (r: string) => rts.get(r)
  for (const id of ['app', 'bff', 'api', 'storage']) rts.set(id, Runtimes.create(Registries.create(id), undefined, { peers }))
  const [app, bff, api, storage] = ['app', 'bff', 'api', 'storage'].map(id => rts.get(id)!) as [Runtime, Runtime, Runtime, Runtime]
  const add = (rt: Runtime, id: string, c: Component) => must(rt.registry.add(id, Components.instantiate(c)))
  add(storage, 'db', MemoryDb)
  add(api, 'rules', PersonRules); add(api, 'persons', PersonService)
  add(bff, 'bff', WebBff)
  add(app, 'rules', PersonRules); add(app, 'form', PersonForm)
  must(api.registry.bind('persons', 'db', { registry: 'storage', instance: 'db' }))
  must(api.registry.bind('persons', 'rules', { registry: 'api', instance: 'rules' }))
  must(bff.registry.bind('bff', 'persons', { registry: 'api', instance: 'persons' }))
  if (opts.bindFormBff !== false) must(app.registry.bind('form', 'bff', { registry: 'bff', instance: 'bff' }))
  must(app.registry.bind('form', 'rules', { registry: 'app', instance: 'rules' }))
  const seen: string[] = []
  for (const rt of [app, bff, api, storage]) rt.listen(t => { if (t.kind === 'call') seen.push(`${rt.registry.id}/${t.target}.${t.op.split('/').pop()}`) })
  const call = (op: keyof typeof Form.ops, arg: unknown) => app.call(ui, 'form', Ops.key(Form.ops[op]!), arg)
  return { app, bff, api, storage, seen, call }
}
const ada = { name: 'Ada', email: 'ada@example.com', postcode: 'sw1a 1aa' }

test('a valid person goes down every layer and comes back as an id', async () => {
  const { seen, call } = build()
  const r = must(await call('submit', ada)) as Outcome<string>
  expect(r.ok).toBe(true)
  expect(seen).toEqual(['app/rules.check', 'api/rules.check', 'storage/db.save', 'api/persons.create', 'bff/bff.save', 'app/form.submit'])
  expect((must(await call('people', null)) as Stored[]).map(s => s.person.postcode)).toEqual(['SW1A 1AA'])
  expect(must(await call('lookup', 'ada'))).toEqual({ ok: true, value: r.ok ? r.value : '' })
})

test('an invalid person stops in the app layer: no traffic below it', async () => {
  const { seen, call } = build()
  expect(must(await call('submit', { name: 'Bob', email: 'nope', postcode: 'x' }))).toEqual({ ok: false, reason: 'email looks wrong' })
  expect(seen).toEqual(['app/rules.check', 'app/form.submit'])
})

test('swapping storage with registry.replace takes effect on the next call, with no rebinding', async () => {
  const { storage, call } = build()
  expect((must(await call('submit', ada)) as Outcome<string>).ok).toBe(true)
  must(storage.registry.replace('db', Components.instantiate(ReadOnlyDb)))
  expect(must(await call('submit', ada))).toEqual({ ok: false, reason: "couldn't save: read only" })
})

test('rebinding a need takes effect on the next call', async () => {
  const { storage, api, call } = build()
  must(storage.registry.add('ro', Components.instantiate(ReadOnlyDb)))
  must(api.registry.bind('persons', 'db', { registry: 'storage', instance: 'ro' }))
  expect(must(await call('submit', ada))).toEqual({ ok: false, reason: "couldn't save: read only" })
})

test('an unbound need fails with "<instance> needs <need>: not bound"', async () => {
  const { call } = build({ bindFormBff: false })
  expect(await call('submit', ada)).toEqual({ error: 'form needs bff: not bound' })
})

test('a binding to an unknown registry fails with "no runtime <registry>"', async () => {
  const { app, call } = build()
  must(app.registry.bind('form', 'bff', { registry: 'nowhere', instance: 'bff' }))
  expect(await call('submit', ada)).toEqual({ error: 'no runtime nowhere' })
})

test('a call to a removed target fails with the runtime\'s own error', async () => {
  const { storage, call } = build()
  must(storage.registry.remove('db'))
  expect(await call('submit', ada)).toEqual({ error: 'no instance db in storage' })
})

// typebox 1.x has no Type.Uint8Array: a refined Unsafe stands in for it
const Bytes = Type.Refine(Type.Unsafe<Uint8Array>({}), v => v instanceof Uint8Array)
const Signer = iface('example/signer', { sign: { in: Type.Object({ publicKey: Type.String(), purpose: Type.String(), bytes: Bytes }), out: Bytes } })
const Signs = iface('example/signs', { run: { in: Type.Object({ bytes: Bytes }), out: Bytes } })
const Signing = define('example/signing', Signs, { signer: Signer }, ({ signer }) => ({ run: ({ bytes }) => signer.sign({ publicKey: 'k', purpose: 'p', bytes }) }))
const twoInOne = (sign: (a: { bytes: Uint8Array }) => Uint8Array, app: Component = Signing) => {
  const rt = Runtimes.create(Registries.create('r'))
  must(rt.registry.add('signer', Components.instantiate(define('example/key', Signer, {}, () => ({ sign })))))
  must(rt.registry.add('app', Components.instantiate(app)))
  must(rt.registry.bind('app', 'signer', { registry: 'r', instance: 'signer' }))
  return (bytes: Uint8Array) => rt.call(ui, 'app', Ops.key(Signs.ops.run!), { bytes })
}

test('binary passes through a client unchanged', async () => {
  const sig = new Uint8Array([9, 8, 7])
  const r = await twoInOne(({ bytes }) => { expect(bytes).toEqual(new Uint8Array([1, 2])); return sig })(new Uint8Array([1, 2]))
  expect(isOk(r) && r.value).toBe(sig)
})

test("a provider's error reaches the caller as a thrown error", async () => {
  const caught: string[] = []
  const Catcher = define('example/catcher', Signs, { signer: Signer }, ({ signer }) => ({
    run: async ({ bytes }) => { try { return await signer.sign({ publicKey: 'k', purpose: 'p', bytes }) } catch (e) { caught.push((e as Error).message); throw e } },
  }))
  expect(await twoInOne(() => { throw new Error('locked') }, Catcher)(new Uint8Array())).toEqual({ error: 'locked' })
  expect(caught).toEqual(['locked'])
})

test('an environment with no handle is not in a registry', async () => {
  const inst = Components.instantiate(PersonForm)
  expect(await inst.env.use('bff', Bff.ops.save!, ada)).toEqual({ error: 'not in a registry' })
})
