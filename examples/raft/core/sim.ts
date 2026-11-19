/**
 * Test helper: a pure, seeded simulator of a Raft cluster. Each node ticks every 10 ms of sim time; every `send` is
 * delivered 10–30 ms later (seeded). One seeded `draw` feeds the nodes and the network, so a seed is a whole run.
 */
import { initial, step } from './step.ts'
import type { Effect, Input, Node, Persistent } from './types.ts'

/** A scripted action; a `restart` reloads the node's ledger, so the script doesn't name `p`. */
export type Scripted = { at: number; to: string; input: Exclude<Input, { kind: 'restart' }> | { kind: 'restart' } }
/** The cluster after one event: every node's state and every node's ledger. */
export type Frame = { at: number; to: string; input: Input; nodes: Record<string, Node>; ledgers: Record<string, Persistent> }
export type Run = { frames: Frame[]; refusals: { at: number; to: string; effect: Effect }[] }

/** mulberry32: a small seeded generator in [0, 1). */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
export const ids = (size: number) => Array.from({ length: size }, (_, i) => `n${i + 1}`)

export function simulate({ size, seed, script = [], until = 2000 }: { size: number; seed: number; script?: Scripted[]; until?: number }): Run {
  const draw = seeded(seed), names = ids(size)
  const empty: Persistent = { currentTerm: 0, votedFor: null, log: [] }
  const ledgers = Object.fromEntries(names.map(id => [id, empty]))
  const nodes = Object.fromEntries(names.map(id => [id, initial(id, names.filter(x => x !== id), empty, 0, draw)]))
  const due = new Map<number, Scripted[]>()
  const at = (e: Scripted) => { if (!due.has(e.at)) due.set(e.at, []); due.get(e.at)!.push(e) }
  script.forEach(at)
  const run: Run = { frames: [], refusals: [] }
  for (let t = 0; t <= until; t++) {
    const ticks: Scripted[] = t % 10 === 0 ? names.map(to => ({ at: t, to, input: { kind: 'tick' } })) : []
    for (const e of [...(due.get(t) ?? []), ...ticks]) {
      const input: Input = e.input.kind === 'restart' ? { kind: 'restart', p: ledgers[e.to] } : e.input
      const { node, effects } = step(nodes[e.to], input, t, draw)
      nodes[e.to] = node
      for (const effect of effects) {
        if (effect.kind === 'persist') ledgers[e.to] = effect.p
        else if (effect.kind === 'send') {
          at({ at: t + 10 + Math.floor(draw() * 21), to: effect.to, input: { kind: 'receive', from: e.to, rpc: effect.rpc } })
        } else run.refusals.push({ at: t, to: e.to, effect })
      }
      run.frames.push({ at: t, to: e.to, input, nodes: { ...nodes }, ledgers: { ...ledgers } })
    }
  }
  return run
}

/** The running leaders in a frame (a stopped node may still think it leads). */
export const leaders = (f: Frame) => Object.values(f.nodes).filter(n => n.role === 'leader' && !n.stopped)
const toAll = (size: number, at: number, input: Scripted['input']) => ids(size).map(to => ({ at, to, input }))
const request = (value: unknown) => ({ kind: 'request', value }) as const
const stop = { kind: 'stop' } as const, resume = { kind: 'resume' } as const
/** The leader a plain run of this size and seed has at 1000 ms; a scenario aims at it, knowing the run is the same. */
const leaderAt1000 = (size: number, seed: number) => leaders(simulate({ size, seed, until: 1000 }).frames.at(-1)!)[0].id

/** Every scripted run the tests look at; the safety tests check all of them, event by event. */
export function scenarios(): Record<string, Run> {
  const runs: Record<string, Run> = {}
  for (const size of [3, 5]) for (let seed = 1; seed <= 5; seed++) runs[`election ${size}/${seed}`] = simulate({ size, seed })
  runs.replicate = simulate({ size: 3, seed: 1, until: 1500, script: [
    { at: 0, to: 'n1', input: request('too early') },
    ...['a', 'b', 'c'].flatMap((v, i) => toAll(3, 1000 + 50 * i, request(v)))] })
  // Two followers stop; the rest commit. They come back with stale logs and one times out at once: it must not win.
  const m = leaderAt1000(5, 2), behind = ids(5).filter(x => x !== m).slice(0, 2)
  runs.minority = simulate({ size: 5, seed: 2, until: 2200, script: [
    ...behind.map(to => ({ at: 1000, to, input: stop })), ...toAll(5, 1100, request('x')),
    ...behind.map(to => ({ at: 1400, to, input: resume })), { at: 1450, to: behind[0], input: { kind: 'time-out' } }] })
  // Three followers stop: the leader takes a request it cannot commit, then stops too. Then all come back.
  const j = leaderAt1000(5, 3), down = ids(5).filter(x => x !== j).slice(0, 3)
  runs.majority = simulate({ size: 5, seed: 3, until: 3200, script: [
    ...down.map(to => ({ at: 1000, to, input: stop })), ...toAll(5, 1100, request('blocked')),
    { at: 1300, to: j, input: stop }, ...[j, ...down].map(to => ({ at: 2000, to, input: resume })),
    ...toAll(5, 2600, request('after'))] })
  const r = leaderAt1000(3, 4)
  runs.replaced = simulate({ size: 3, seed: 4, until: 2800, script: [
    { at: 1005, to: r, input: request('lost') }, { at: 1005, to: r, input: stop },
    ...toAll(3, 1800, request('kept')), { at: 1900, to: r, input: resume }] })
  runs.restart = simulate({ size: 3, seed: 5, until: 1800, script: [
    ...toAll(3, 1000, request('r')), { at: 1300, to: 'n1', input: { kind: 'restart' } }] })
  return runs
}
