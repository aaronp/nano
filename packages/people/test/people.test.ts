// Save a person, headless: the four layers built through the application's ops, then wrapped and swapped.
import { expect, test } from 'bun:test'
import { Components, define, Ops, type Op, type Runtime } from '@pritzlaff/nano-core'
import { ApplicationOps as P, applyApp, checkApp, createApplication, runtimeOf, type HostStores } from '@pritzlaff/nano-app'
import { catalog, Db, PersonForm, Validation, type Person } from '../src'
import doc from '../people.nano.json'

const ada = { name: 'Ada', email: 'ada@example.com', postcode: 'sw1a 1aa' }
const no = (reason: string) => ({ ok: false as const, reason })

const StricterRules = define('test/stricter-rules', Validation, { inner: Validation }, ({ inner }) => ({
  check: async x => ((x as Person | null)?.name?.trim().length ?? 0) < 2 ? no('name is too short') : inner.check(x),
}))
const ReadOnlyDb = define('test/read-only-db', Db, {}, () => ({ save: () => no('read only'), load: () => null, keys: () => [] }))

const app = () => {
  const { host, catalog: all } = createApplication({ catalogs: [catalog, { 'stricter-rules': { component: StricterRules } }] })
  const call = async (op: Op, arg: unknown = null) => { const r = await host.call({ registry: 'host', instance: 'test' }, 'application', Ops.key(op), arg) as any; if ('error' in r) throw new Error(r.error); return r.value }
  const rt = (system: string) => runtimeOf(host.registry, system)!
  return { host, all, call, rt }
}

/** The four layers, each instance made and each need bound by the application's ops. */
async function build() {
  const a = app(), { call } = a
  for (const s of ['app', 'bff', 'api', 'storage']) await call(P.createSystem, s)
  const make = (kind: string, name: string, system: string) => call(P.createComponent, { kind, name, system })
  const bind = (from: string, need: string, to: string) => call(P.bindNeed, { ref: `instance:${from}`, need, to: `instance:${to}` })
  await make('people-db', 'db', 'storage')
  await make('person-rules', 'rules', 'api'); await make('person-service', 'persons', 'api')
  await make('people-bff', 'bff', 'bff')
  await make('person-rules', 'rules', 'app'); await make('person-form', 'form', 'app')
  await bind('api/persons', 'db', 'storage/db'); await bind('api/persons', 'rules', 'api/rules')
  await bind('bff/bff', 'persons', 'api/persons')
  await bind('app/form', 'bff', 'bff/bff'); await bind('app/form', 'rules', 'app/rules')
  const seen: string[] = []
  for (const s of ['app', 'bff', 'api', 'storage']) a.rt(s).listen(t => { if (t.kind === 'call') seen.push(`${s}/${t.target}.${t.op.split('/').pop()}`) })
  const form = (op: keyof typeof PersonForm.ops, arg: unknown = null) => a.rt('app').call({ registry: 'app', instance: 'test' }, 'form', Ops.key(PersonForm.ops[op]), arg) as Promise<any>
  return { ...a, make, bind, seen, form }
}

test('submit goes down every layer, and the form and db show the person', async () => {
  const { seen, form, rt } = await build()
  const r = (await form('submit', ada)).value
  expect(r.ok).toBe(true)
  expect(seen).toEqual(['app/rules.check', 'api/rules.check', 'storage/db.save', 'api/persons.create', 'bff/bff.save',
    'storage/db.keys', 'storage/db.load', 'api/persons.list', 'bff/bff.listPersons',   // then the form reads the people again
    'app/form.submit'])
  expect((await form('people')).value.map((s: any) => s.person.postcode)).toEqual(['SW1A 1AA'])
  expect((await form('lookup', 'ada')).value).toEqual({ ok: true, value: r.value })
  const db = rt('storage')
  const entries = await db.call({ registry: 'storage', instance: 'test' }, 'db', 'composable.people/memory-db/entries', null) as any
  expect(entries.value).toEqual([{ key: r.value, value: { name: 'Ada', email: 'ada@example.com', postcode: 'SW1A 1AA' } }])
})

test('an invalid person stops in the app layer', async () => {
  const { seen, form } = await build()
  expect((await form('submit', { name: 'Bob', email: 'nope', postcode: 'x' })).value).toEqual(no('email looks wrong'))
  expect(seen).toEqual(['app/rules.check', 'app/form.submit'])
})

test('wrapping validation: stricter rules in front of the person rules refuse a one-letter name', async () => {
  const { make, bind, form } = await build()
  await make('stricter-rules', 'strict', 'app')
  await bind('app/strict', 'inner', 'app/rules'); await bind('app/form', 'rules', 'app/strict')
  expect((await form('submit', { ...ada, name: 'A' })).value).toEqual(no('name is too short'))
  expect((await form('submit', { ...ada, email: 'nope' })).value).toEqual(no('email looks wrong'))   // the inner rules still apply
  expect((await form('submit', ada)).value.ok).toBe(true)
})

test('swapping storage: a read-only db in place of people-db', async () => {
  const { rt, form } = await build()
  expect((await form('submit', ada)).value.ok).toBe(true)
  rt('storage').registry.replace('db', Components.instantiate(ReadOnlyDb))
  expect((await form('submit', ada)).value).toEqual(no("couldn't save: read only"))
})

test('people.nano.json passes checkApp and loads with no notes, every need bound', async () => {
  expect(typeof checkApp(doc)).not.toBe('string')
  const { host, all, rt } = app()
  const st = { imports: [] as any[], theme: { theme: 'enterprise', mode: 'system' as const }, title: '' }
  const stores: HostStores = { imports: { list: () => st.imports, set: xs => { st.imports = xs } }, theme: { get: () => st.theme, set: () => {} }, title: { get: () => st.title, set: t => { st.title = t } } }
  const notes = await applyApp(checkApp(doc) as any, 'replace', { host, stores, catalog: all, known: { theme: () => true, icon: () => true }, importPackage: async () => ({}) })
  expect(notes).toEqual([])
  const r: Runtime = rt('app')
  const out = await r.call({ registry: 'app', instance: 'test' }, 'form', Ops.key(PersonForm.ops.submit), ada) as any
  expect(out.value.ok).toBe(true)
})
