# AGENTS.md

How to work in this repository: a provider of pods for nano apps, with a view each. `README.md` is the reference;
this file is what to do, and what not to.

## The shape

- **An interface** (`src/interfaces.ts`): `ns.interface('<Name>', { op… })` (`const ns = Coord.namespace('acme.template')`) with `Op.action(Input, Output)` and
  `Op.event(Data)`, each op named by its key; schemas come from `Schema.define(Type…, label?)` and nest directly.
- **An implementation** (`src/<thing>.ts`): start from the contract it provides,
  `Iface.impl('acme.template/<thing>').needs({ … }).config(Type…).make(({ deps, config, ...ctx }) => plainObject)` (or
  `.create({ needs, config, make })`, `.satisfies(Other, make)`); `Implementation.define(coord, { provides, make })` is the explicit form.
- **A host** loads it all with `await Application.load(new URL('./nano.json', import.meta.url))`, then `app.get(Iface)`
  (`app.resolve(Iface)` says which pod it found, or why not).
  `make` runs once per build, closes over its state and returns a plain object, one method per op: an action's value is
  its success, a throw its failure (`threw`; an Error carrying `fail`, as `src/calculator.ts` does, is that failure).
  An event's method may be `async *event() {}` with the event published by `ctx.publish(Iface.ops.event, data)`; clean
  up in `ctx.addOnCloseListener`.
- **A view** (`src/<thing>-view.ts`): a custom element extending `View` (`src/view.ts`) with `target`. It reaches pods only by
  `this.pod(t).action(input)`, `listen` (`hear`) and the runtime's typed client; no logic the pod could hold.
- **The provider** (`src/index.ts`): `export default ns.provider([...])`, `export const views = { '<impl coord>': '<tag>' }`,
  and `customElements.define` for each tag.
- **`nano.json`**: pods, runtimes, pipes (`source`/`target` are `<iface coord>/<op>`), and `modules`.

`src/calculator.ts`, `history.ts` and `calculator-view.ts` are the worked examples. Copy their shape.

## Commands

```sh
bun install
bun test          # must pass before you're done
bun run build     # dist/: index.js, nano.json
bun run serve     # build and serve dist/ at http://localhost:4000, to import into a host
```

## Adding a pod

1. The interface in `src/interfaces.ts`. To pipe an event into an action, give them one schema (the same `Schema.define`
   value) or make the action's input `Type.Unknown()`.
2. `src/<thing>.ts` and its test in `test/pods.test.ts`: assemble `nano.json` with `test/app.ts`'s `open()`, call the pod
   (`app.call('main', '<pod>')`), and check results. Give a config schema if the pod takes one (hosts pass untrusted values).
3. `src/<thing>-view.ts` and a test in `test/views.test.ts`: mount the tag with a `target`, click and type (happy-dom is
   preloaded by `bunfig.toml`), and check the page and the pod's state.
4. `src/index.ts`: add it to the provider, `views` and the tag list; add the pod to `nano.json` (and its pipes).

Removing the examples: delete their files, tests, provider entries and `nano.json` entries together.

## Rules

- **Imports.** The host provides `@pritzlaff/nano-core`, `nano-elements`, `nano-ui`, `lit` and `typebox` (and their
  subpaths). Anything else gets bundled into `dist/index.js`; keep that small, and don't add a second copy of lit or typebox.
- **A view depends on no host.** Only `target.app` (`call`, `listen`, `runtime(…).get`).
- **Styles.** Use `--nano-*` tokens, always with a fallback, never hard-coded colours or fonts alone. Start from `base` and `kit`
  and the kit's elements before writing CSS or widgets of your own.
- **No `<form>` submit.** A host may run a view in a sandboxed iframe, where forms are blocked: act on a button's click and on Enter.
- **Accessibility.** Label inputs (`aria-label` or a `<label>`), use real `<button>`s, keep keyboard use working.
- **Don't edit** `dist/` (built).
- **Don't change** a released interface's op names or schemas without a new major version: saved `nano.json`s name them.
- Keep files small and focused, and comment what a thing is for, not how it works.

## Done means

`bun test` passes, `bun run build` succeeds, and importing `dist/nano.json` (`bun run serve`) into a host shows the pods working.
