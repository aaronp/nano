// A Lit element over one model instance. It joins the model's registry as an ordinary subscriber (a hidden view
// instance), re-renders when the model publishes, and acts by calling the model through its own handle.
import { LitElement } from 'lit'
import { Type } from 'typebox'
import { Components, Ops, type Handle, type Op, type Registry, type Result } from '@composable/core'

let n = 0

/** Base class for an element that shows and drives one model: set `registry` and `model` (the instance id). */
export abstract class ModelElement extends LitElement {
  static properties = { registry: { attribute: false }, model: {}, problem: { state: true } }
  declare registry?: Registry
  declare model?: string
  /** The last refusal from `act`, for rendering. */
  declare problem?: string
  #values = new Map<string, unknown>()
  #view?: { id: string; handle: Handle; registry: Registry }

  connectedCallback() { super.connectedCallback(); this.#attach() }
  disconnectedCallback() { super.disconnectedCallback(); this.#detach() }
  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('registry') || changed.has('model')) { this.#detach(); this.#attach() }
  }

  /** The model's latest value for a source op. */
  read<T>(op: Op): T | undefined { return this.#values.get(Ops.key(op)) as T | undefined }

  /** Calls an action on the model; a refusal is kept in `problem`. */
  async act(op: Op, arg: unknown = null): Promise<Result> {
    if (!this.#view || !this.model) return { error: 'not attached to a model' }
    const r = await this.#view.handle.call(this.model, op, arg)
    this.problem = 'error' in r ? r.error : undefined
    return r
  }

  #attach() {
    const reg = this.registry, model = this.model && reg?.get(this.model)
    if (!reg || !model || this.#view || !this.isConnected) return
    const id = `${this.model}~view-${n++}`, sources = [...model.actions.values()].filter(a => a.op.output && !a.op.input)
    const view = Components.create({ ns: 'composable.editor', name: 'view' }, () => this)
    for (const a of sources) {
      const key = Ops.key(a.op)
      view.action(Ops.sink('composable.editor/view', key, Type.Unknown()), (el, data) => { el.#values.set(key, data); el.requestUpdate() })
    }
    reg.add(id, Components.instantiate(view))
    for (const a of sources) reg.subscribe({ source: this.model!, op: Ops.key(a.op), listener: id, target: `composable.editor/view/${Ops.key(a.op)}` })
    this.#view = { id, handle: reg.get(id)!.env.handles()[0]!, registry: reg }
    // read what the model holds now: sources with a reader answer a call
    for (const a of sources) if (a.run) void this.#view.handle.call(this.model!, a.op, null).then(r => {
      if ('value' in r) { this.#values.set(Ops.key(a.op), r.value); this.requestUpdate() }
    })
  }

  #detach() {
    this.#view?.registry.remove(this.#view.id)   // from the registry it joined, even if `registry` has changed since
    this.#view = undefined
  }
}
