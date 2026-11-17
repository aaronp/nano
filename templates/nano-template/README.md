# nano-template

A starting point for components of a nano app, built on the published
[`@pritzlaff/nano-core`](https://www.npmjs.com/package/@pritzlaff/nano-core), `nano-elements` and `nano-ui`.
The build is a provider module (`dist/index.js`) and a `dist/nano.json`; a host imports the app by the `nano.json`'s URL.

It ships three pods in one provider, `acme.template`, to start from:

- **timer** (`src/timer.ts`): `start`, `stop`, and the event `tick` (each count, as `{ key: 'tick', value }`);
  its view `<nano-timer>` (`src/timer-view.ts`) has Start and Stop and labels the count "ticks seen" (the ticks it has seen since it opened);
- **picker** (`src/picker.ts`): `pick` (a value outside the options fails), `setOptions`, `options`, and the event `changed`
  (`{ key: 'choice', value }`); its view `<nano-picker>` reads `options` and shows the kit's filterable `<nano-select>`;
- **store** (`src/store.ts`): `get`, `set`, `remove`, `entries` and the event `changed`, kept in `localStorage` (memory
  where there is none); its view `<nano-store>` lists the entries.

`nano.json` places all three in runtime `main`, and pipes `picker.changed` and `timer.tick` to `store.set`: an event
can be piped to an action when its data has the action's input schema (`Entry`, in `src/interfaces.ts`).
`<nano-timer>` does not rely on that pipe: while connected it subscribes to its own pod's `tick` (through the `Timer`
interface) and counts what arrives, so a timer added with no pipes counts too.

## Make it yours

Use this repository as a template (GitHub's "Use this template"), then rename:

1. `package.json`: `name`, `description`, `version`.
2. The provider `acme.template` (`src/index.ts`, `nano.json`'s `modules` and pod `implementation`s), the
   implementation coordinates `acme.template/…` and the interfaces `acme.template.Timer`… (`src/interfaces.ts`, and the
   pipes' `source` and `target`): use your own namespace. A host refuses an import that clashes with a name it has.
3. The tags (`nano-timer`…) in `src/index.ts`: custom element names need a dash.

## Develop

```sh
bun install
bun test           # the pods through assemble + Application, the views, the build
bun run build      # dist/: index.js, nano.json
bun run serve      # build, then serve dist/ at http://localhost:4000
```

A host imports an app from its own origin only (cross-origin comes later): put the build in the host's public dir (the
nano workspace's build already copies it to `/examples/template/`, so import `/examples/template/nano.json`), or serve
the host and `dist/` from one origin. The host fetches the `nano.json`, loads each `modules` entry (relative to the
`nano.json`) and shows the pods. Importing alongside another app whose runtime is also `main` is refused: the names
clash (namespacing comes later).

## What a host gets

- **`dist/nano.json`**: the pods, runtimes and pipes, and `providers`: `{ "acme.template": "./index.js" }`.
- **`dist/index.js`**: the module. Its default export is the provider; its named export `views` maps each
  implementation to its view's tag, and importing it defines the tags. `@pritzlaff/nano-core`, `nano-elements`,
  `nano-ui`, `lit` and `typebox` are left as bare imports: the host provides them through its import map, so there
  is one copy of each.

## Views and looks

A view is a custom element with a `target: { app, registry, runtime, pod }` property. It reaches its pod only through
`target.app.call(target.runtime, target.pod)` and `target.app.listen`, so it works in any host (`src/view.ts` is the
small base these use). Style with the `--nano-*` tokens (colours, fonts, radius), with fallbacks, so a view takes on any
host's theme; start from `base` and `kit` (`.btn`, `.badge`, `.input-group`…) and the kit's elements
(`<nano-select>`, `<nano-date-picker>`, `<nano-data-table>`, `toast()`…) from `@pritzlaff/nano-elements`.

## Publishing

CI (`.github/workflows/ci.yml`) tests and builds on every push. `pages.yml` publishes `dist/` to GitHub Pages, so
`https://<owner>.github.io/<repo>/nano.json` is the app's URL (a host on that origin can import it).
