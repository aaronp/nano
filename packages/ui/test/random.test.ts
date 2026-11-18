/**
 * The real random pod draws from Math.random; the seeded one repeats its sequence for a seed, from the start after a restart.
 */
import { expect, test } from 'bun:test'
import { Coord, Application, AppDeployment, Registry, Pod, type NanoResult } from '@pritzlaff/nano-core'
import uiProvider, { random, seededRandom } from '../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const deployment = (impl: typeof random | typeof seededRandom, config?: unknown): AppDeployment => ({
  pods: { rnd: Pod.eager(impl, { config }) },
  runtimes: { main: { pods: ['rnd'], subscriptions: [] } },
})
const registry = () => { const r = Registry.create(); r.add(uiProvider); return r }
const open = async (impl: typeof random | typeof seededRandom, config?: unknown) => {
  const app = must(await Application.create(must(AppDeployment.assemble(deployment(impl, config), registry())), {}))
  const rnd = app.call('main', 'rnd') as any
  const draw = async () => must(await rnd.next(null)) as number
  const draws = async (n: number) => { const out: number[] = []; for (let i = 0; i < n; i++) out.push(await draw()); return out }
  return { app, rnd, draw, draws }
}

test('same seed, same sequence; different seeds differ', async () => {
  const a = await (await open(seededRandom, { seed: 42 })).draws(5)
  expect(await (await open(seededRandom, { seed: 42 })).draws(5)).toEqual(a)
  expect(await (await open(seededRandom, { seed: 43 })).draws(5)).not.toEqual(a)
})

test('a restart repeats from the start', async () => {
  const { app, draws } = await open(seededRandom, { seed: 9 })
  const first = await draws(3)
  must(await app.restart('rnd'))
  expect(await draws(3)).toEqual(first)
})

test('values are in [0, 1)', async () => {
  for (const v of await (await open(seededRandom)).draws(1000)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
})

test('seed 0 and seed -7 give varied values', async () => {
  for (const seed of [0, -7]) expect(new Set(await (await open(seededRandom, { seed })).draws(20)).size).toBeGreaterThanOrEqual(15)
})

test('concurrent draws are distinct, in call order', async () => {
  const { rnd } = await open(seededRandom, { seed: 5 })
  const together = (await Promise.all([1, 2, 3, 4, 5].map(() => rnd.next(null)))).map(must)
  expect(together).toEqual(await (await open(seededRandom, { seed: 5 })).draws(5))
  expect(new Set(together).size).toBe(5)
})

test('apply with a new seed restarts from it', async () => {
  const { app, draws } = await open(seededRandom, { seed: 1 })
  await draws(2)
  must(await app.apply(deployment(seededRandom, { seed: 2 })))
  expect(await draws(3)).toEqual(await (await open(seededRandom, { seed: 2 })).draws(3))
})

test('the real random returns values in [0, 1)', async () => {
  for (const v of await (await open(random)).draws(50)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
})
