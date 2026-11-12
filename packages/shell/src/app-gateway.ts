// The AppGateway: which view or panel is focused, and whose controls the app bar shows. Live UI state, never persisted.
import { Type, type Static } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'

const Focus_ = Type.Union([
  Type.Object({
    system: Type.String({ description: 'The system the focused view is in', examples: ['host'] }),
    instance: Type.String({ description: 'The focused view or panel instance', examples: ['p1'] }),
    widget: Type.Optional(Type.String({ description: 'The part of the view that has focus', examples: ['workspace'] })),
  }),
  Type.Null(),
], { description: 'What has focus (null for nothing)', examples: [{ system: 'host', instance: 'p1', widget: 'workspace' }, null] })
const Target_ = Type.Union([
  Type.Object({
    system: Type.String({ description: 'The system the component is in', examples: ['host'] }),
    instance: Type.String({ description: 'The component instance whose controls the app bar shows', examples: ['ws-controls-workspace'] }),
  }),
  Type.Null(),
], { description: 'The component the app bar shows (null for none)', examples: [{ system: 'host', instance: 'ws-controls-workspace' }, null] })

export type Focus = Static<typeof Focus_>
export type Target = Static<typeof Target_>

/** Focus and the app bar. The dock sets focus; the focused component says what the bar shows; the default shows otherwise. */
export const AppGateway = component('nano.shell/app-gateway', () => {
  const s = state<{ focused: Focus; appBar: Target; fallback: Target }>({ focused: null, appBar: null, fallback: null })
  const focus = event(Focus_)
  return {
    get focused() { return s.focused }, get appBar() { return s.appBar },
    focus,
    setFocus: (f: Focus) => {
      if (JSON.stringify(f) === JSON.stringify(s.focused)) return
      s.appBar = s.fallback; s.focused = f
      focus(f)
    },
    // a component puts up controls only from the focused view's system (null clears the bar)
    setAppBarComponent: (t: Target) => { if (t === null || t.system === s.focused?.system) s.appBar = t },
    setAppBarDefault: (t: Target) => {
      if (JSON.stringify(s.appBar) === JSON.stringify(s.fallback)) s.appBar = t
      s.fallback = t
    },
  }
}, {
  focused: Focus_,
  appBar: Target_,
  focus: Focus_,
  setFocus: { in: Focus_, description: 'Moves focus (a no-op if unchanged): the app bar returns to its default, then focus is published' },
  setAppBarComponent: { in: Target_, description: 'Sets the component whose controls the app bar shows, until focus next changes; ignored unless null or in the focused view\'s system' },
  setAppBarDefault: { in: Target_, description: 'Sets the app bar component shown when no focused component overrides it' },
}, { description: 'Which view is focused and whose controls the app bar shows' })
