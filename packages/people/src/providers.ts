// The headless layers: the person rules, the api's service and the web bff. Each calls down only through its needs.
import { Value } from 'typebox/value'
import { define } from '@pritzlaff/nano-core'
import { Bff, Db, no, ok, Person, PersonApi, Validation, type Stored } from './interfaces'

export const PersonRules = define('composable.people/person-rules', Validation, {}, () => ({
  check: (x: unknown) => {
    if (!Value.Check(Person, x)) return no('name, email and postcode are required')
    const p = x as Person
    if (!p.name.trim()) return no('name is empty')
    if (!/^[^@\s]+@[^@\s]+$/.test(p.email)) return no('email looks wrong')
    if (!/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(p.postcode)) return no('postcode looks wrong')
    return ok({ name: p.name.trim(), email: p.email, postcode: p.postcode.toUpperCase() })
  },
}), { description: 'Checks a person and tidies it: a trimmed name, an upper-case postcode' })

export const PersonService = define('composable.people/person-service', PersonApi, { db: Db, rules: Validation }, ({ db, rules }) => {
  const get = async (id: string) => { const p = await db.load(id); return p ? { id, person: p as Person } : null }
  return {
    async create(p) {
      const checked = await rules.check(p)   // don't trust the caller, even with a schema
      if (!checked.ok) return checked
      const saved = await db.save({ key: `person-${crypto.randomUUID().slice(0, 8)}`, value: checked.value })
      return saved.ok ? saved : no(`couldn't save: ${saved.reason}`)
    },
    get,
    async list() { return (await Promise.all((await db.keys(null)).map(get))).filter((x): x is Stored => !!x) },
  }
}, { description: 'Creates, gets and lists people, checked before they are stored' })

export const WebBff = define('composable.people/web-bff', Bff, { persons: PersonApi }, ({ persons }) => ({
  save: p => persons.create(p),
  listPersons: () => persons.list(null),
  getPerson: id => persons.get(id),
  async lookup(name) {
    const hit = (await persons.list(null)).find(s => s.person.name.toLowerCase() === name.trim().toLowerCase())
    return hit ? ok(hit.id) : no(`no one called ${name}`)
  },
}), { description: 'What the form needs from the api, and nothing else' })
