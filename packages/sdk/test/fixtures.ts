import Type from 'typebox'
import { defineManifest, ok, type Context, type Invocation, type InstanceRef, type Component, type ComponentFactory } from '../src'

export const rootRef: InstanceRef = { namespace: [], instance: 'root' }

export const echoManifest = (author: string, id: string) => defineManifest({
  id: { author, id }, version: '0.1.0',
  emits: [{ name: 'fired', schema: Type.Object({ text: Type.String() }) }],
  consumes: [{ name: 'log', input: Type.Unknown() }],
})

/** Records every received invocation; `log` returns its input. `ctxs`/`disposed` are exposed for tests. */
export const echoFactory = (author: string, id: string) => {
  const received: Invocation[] = []
  const state = { ctx: undefined as Context | undefined, disposed: 0 }
  const factory: ComponentFactory = {
    manifest: echoManifest(author, id),
    create(ctx) {
      state.ctx = ctx
      const c: Component & { dispose(): void } = {
        manifest: factory.manifest,
        onAction: async inv => { received.push(inv); return ok(inv.input) },
        dispose() { state.disposed++ },
      }
      return c
    },
  }
  return Object.assign(factory, { received, state })
}
