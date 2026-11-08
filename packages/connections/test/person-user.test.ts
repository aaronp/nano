/**
 * The Person → User example, end to end:
 *   - two existing CRUD libraries (plain TypeScript, no knowledge of the SDK) are lifted into components;
 *   - a map component, written at runtime, turns a Person into a User; it declares an `enrich` dependency (a date
 *     of birth lookup) that something must be bound to;
 *   - everything is created through a System component, a binder policy binds dependencies to whatever provides
 *     them, and an orchestrator policy wires the chain people.create → map → users.create once it is viable.
 */
import { test, expect } from 'bun:test'
import Type from 'typebox'
import { unwrap, Components, Systems, ok } from '@composable/sdk'
import { Binders, Orchestrators, plan, type Intent } from '../src'
const links = (s: { snapshot(): { subscriptions: { source: string; listener: string; target?: string }[] } }) => s.snapshot().subscriptions.filter(x => x.target)

// ---- two plain libraries, as they might already exist
type PersonT = { name: string; age: number }
type UserT = { userId: string; firstName: string; lastName: string; dateOfBirth: string }
class PersonStore { people: PersonT[] = []; create(p: PersonT) { this.people.push(p); return p } }
class UserStore { users: UserT[] = []; create(u: UserT) { this.users.push(u); return u } }
const birthdays: Record<string, string> = { 'Ada Lovelace': '1815-12-10' }

// ---- their types, as data (named, so each has its own SAID)
const Person = Type.Object({ name: Type.String(), age: Type.Integer() }, { $id: 'people.Person' })
const User = Type.Object({ userId: Type.String(), firstName: Type.String(), lastName: Type.String(), dateOfBirth: Type.String() }, { $id: 'users.User' })
const Name = Type.Object({ name: Type.String() }, { $id: 'people.Name' })
const Born = Type.Object({ dateOfBirth: Type.String() }, { $id: 'people.Born' })

test('lift two CRUD libraries, map between them with a runtime component that needs a dependency, and chain them', async () => {
  // setup: lift the libraries (their implementations stay plain)
  const personStore = new PersonStore(), userStore = new UserStore()
  const people = Components.lift({ author: 'lib', id: 'people' }, { create: Type.Function([Person], Person) }, { create: p => personStore.create(p) })
  const users = Components.lift({ author: 'lib', id: 'users' }, { create: Type.Function([User], User) }, { create: u => userStore.create(u) })
  const dob = Components.lift({ author: 'lib', id: 'dob' }, { lookup: Type.Function([Name], Born) }, { lookup: ({ name }) => ({ dateOfBirth: birthdays[name] ?? 'unknown' }) })

  // a map component written at runtime: Person → User, needing "something that turns a Name into a Born"
  const M = Components.declare({ author: 'app', id: 'person-to-user' })
  const enrich = M.dependency('enrich', 'look up a date of birth', { op: { name: 'enrich', input: Name, output: Born } })
  const toUser = M.op('to-user', 'Person → User', { input: Person, output: User, requires: [enrich] })
  const map = M.define({ state: () => null, handlers: [[toUser, async (p, { deps }) => {
    const born = await deps.enrich({ name: p.name })
    if (born.type !== 'success') return born
    const [firstName, ...rest] = p.name.split(' ')
    return ok({ userId: p.name.toLowerCase().replace(/\s+/g, '.'), firstName, lastName: rest.join(' '), dateOfBirth: (born.data as { dateOfBirth: string }).dateOfBirth })
  }]] })

  // a system whose catalog can make all four, and a chain people.create → map.to-user → users.create
  const scope = Systems.create({ onError: e => { throw e } }), page = unwrap(scope.register('page', Components.party()))
  scope.register('system', Systems.component(scope, { catalog: [people, users, dob, map] }).create() as never)
  const make = (author: string, id: string, name: string) => page.call('system', Systems.ops.create, { component: { author, id }, name })
  for (const [a, i, n] of [['lib', 'people', 'people'], ['app', 'person-to-user', 'map'], ['lib', 'users', 'users']]) await make(a, i, n)
  const chain: Intent = { kind: 'workflow', id: 'person-to-user', steps: [
    { select: { by: 'name', name: 'people' }, op: people.ops.create.name },
    { select: { by: 'name', name: 'map' }, op: toUser.name },
    { select: { by: 'name', name: 'users' }, op: users.ops.create.name },
  ] }

  // call out our methods under test: plan says why it is not viable yet; the orchestrator waits
  expect(plan([chain], page.system.instances).status['person-to-user'].problems).toEqual([{ kind: 'unavailable', at: 'step 1', needs: ['enrich'] }])
  const o = Orchestrators.create(scope, [chain])
  Binders.firstProvider(scope)
  expect(o.status()['person-to-user'].viable).toBe(false)
  expect(scope.bindings()).toEqual([])

  // a dob service is created at runtime: the binder binds `enrich` to it, and the chain is viable and wired
  await make('lib', 'dob', 'dob')
  expect(scope.bindings()).toEqual([{ from: 'map', dependency: 'enrich', to: 'dob', op: dob.ops.lookup.name }])
  expect(o.status()['person-to-user']).toMatchObject({ viable: true, routes: 2 })

  // creating a person flows through to a user, enriched
  expect(await page.call('people', people.ops.create, { name: 'Ada Lovelace', age: 36 })).toEqual(ok({ name: 'Ada Lovelace', age: 36 }))
  await new Promise(r => setTimeout(r, 0))
  expect(userStore.users).toEqual([{ userId: 'ada.lovelace', firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1815-12-10' }])

  // the provider goes away: its binding goes, the chain stops again, and says why
  await page.call('system', Systems.ops.remove, { name: 'dob' })
  expect(scope.bindings()).toEqual([])
  expect(o.status()['person-to-user'].problems).toEqual([{ kind: 'unavailable', at: 'step 1', needs: ['enrich'] }])
  expect(links(scope)).toEqual([])
})
