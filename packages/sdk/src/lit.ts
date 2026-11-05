import { LitElement } from 'lit'
import type { Component, ComponentFactory, Context, Instance, Manifest, UIComponent } from './types'

/** Base for a widget's view. `model` is whatever the widget's logic returned. */
export class View<M> extends LitElement {
  static properties = { model: { attribute: false } }
  declare model: M
}

/**
 * Pair headless logic with a custom-element view. Views re-render after every handled action and every emit.
 * The same `logic` behind different tags gives different UIs over one API.
 */
const view = <M extends Component>(
  manifest: Manifest, tag: string, logic: (ctx: Context, self: Instance) => M,
): ComponentFactory => ({
  manifest,
  create(ctx, self) {
    const views = new Set<View<M>>()
    const refresh = () => views.forEach(v => v.requestUpdate())
    const model = logic({ ...ctx, emit: async (e, p, s) => { const r = await ctx.emit(e, p, s); refresh(); return r } }, self)
    const component: UIComponent = {
      manifest,
      onAction: async (c, inv) => { const r = await model.onAction(c, inv); refresh(); return r },
      mount(el) { const v = document.createElement(tag) as View<M>; v.model = model; views.add(v); el.append(v) },
      dispose: async () => { views.forEach(v => v.remove()); views.clear(); await model.dispose?.() },
    }
    return component
  },
})

export const Widgets = { view }
