// Wraps plain code: how to make a value, and the actions over it, each named by an op.
import type { Static, TSchema } from 'typebox'
import { err, isOk, ok, Ops, type Op, type Result } from './data'
import { Environments, type Environment } from './env'

type StaticOf<T> = T extends TSchema ? Static<T> : void

/** What an action does: given the instance, the argument and the environment, produce the output. */
export type Run<A, I = any, O = any> = (instance: A, arg: I, env: Environment) => O | Promise<O>

/** An op bound to a run. With no run, it is a source that is only published by `notify`. */
export type Action<A> = { op: Op; run?: Run<A>; emits?: Op[] }

/** A definition: how to make an A, and the actions over it. */
export type Component<A> = {
  id: { ns: string; name: string }
  make(env: Environment): A
  actions: Map<string, Action<A>>
  action<I extends TSchema | undefined, O extends TSchema | undefined>(op: Op<I, O>, run?: Run<A, StaticOf<I>, StaticOf<O>>, opts?: { emits?: Op[] }): 'added' | 'replaced'
}

/** One made value, with its own copy of the actions and its environment. */
export type Instance<A = any> = { component: Component<A>; value: A; actions: Map<string, Action<A>>; env: Environment }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Runs one op on an instance; a throw becomes an error. */
async function run<A>(inst: Instance<A>, key: string, arg: unknown): Promise<Result> {
  const a = inst.actions.get(key)
  if (!a?.run) return err(`unknown op ${key}`)
  try { return ok(await a.run(inst.value, arg, inst.env)) } catch (e) { return err(message(e)) }
}

/** Makes components, instances of them, and invokes their actions. */
export const Components = {
  create<A>(id: { ns: string; name: string }, make: (env: Environment) => A): Component<A> {
    const actions = new Map<string, Action<A>>()
    return {
      id, make, actions,
      action(op, run, opts) {
        const had = actions.has(Ops.key(op))
        actions.set(Ops.key(op), { op, run: run as Run<A>, emits: opts?.emits })
        return had ? 'replaced' : 'added'
      },
    }
  },

  instantiate<A>(component: Component<A>): Instance<A> {
    const actions = new Map(component.actions), env = Environments.create(actions)
    return { component, value: component.make(env), actions, env }
  },

  /** Runs the action, then publishes each op it emits with that op's own reading. The action stands if an emit fails. */
  async invoke(inst: Instance, key: string, arg: unknown): Promise<Result> {
    const r = await run(inst, key, arg)
    if (!isOk(r)) return r
    const failed: Result[] = []
    for (const op of inst.actions.get(key)!.emits ?? []) {
      const read = await run(inst, Ops.key(op), undefined)
      if (!isOk(read)) { failed.push(read); continue }
      for (const sent of await inst.env.notify(op, read.value)) if (!isOk(sent)) failed.push(sent)
    }
    return failed.length ? ok(r.value, { emits: failed }) : r
  },
}
