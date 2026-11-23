# nano-template

A starting point for components of a nano app, built on the published
[`@pritzlaff/nano-core`](https://www.npmjs.com/package/@pritzlaff/nano-core), `nano-elements` and `nano-ui`.
The build is a provider module (`dist/index.js`) and a `dist/nano.json`; a host imports the app by the `nano.json`'s URL.

**[Open it in nano](https://aaronp.github.io/nano/?src=https://aaronp.github.io/nano-template/nano.json)**: the nano app
imports this repository's published `nano.json` (its GitHub Pages site) and starts the calculator and its history, a
micro-front-end loaded by URL.

It ships a calculator with a history, two pods in one provider, `acme.template`, to start from:

- **calculator** (`src/calculator.ts`): `calculate` (`{ a, op, b }`, `op` one of `+ - * /`, answered with the same and
  its `result`) and the event `calculated`, published with each result; division by zero fails `invalid-input`. Config:
  `{ precision }`, the decimals to round to. Its view `<nano-calculator>` (`src/calculator-view.ts`) has two number
  inputs, an operator, `=`, the result, and the history list;
- **history** (`src/history.ts`): `save` and `load`, kept in `localStorage` (memory where there is none).

The calculator knows nothing of the history: `nano.json` places both in runtime `main` and pipes `calculator.calculated`
to `history.save`. An event can be piped to an action when its data has the action's input schema (`Calculated`, in
`src/interfaces.ts`). `<nano-calculator>` listens to its own pod's `calculated` (through the `Calculator` interface) and
reads the history again on each one, so each calculation its pod makes (from this view or any other caller) shows up. (A view in a sandboxed frame reaches
only its own pod, so there the list stays empty; the history pod still saves each result.)

## Make it yours

Use this repository as a template (GitHub's "Use this template"), then rename:

1. `package.json`: `name`, `description`, `version`.
2. The provider `acme.template` (`src/index.ts`, `nano.json`'s `modules` and pod `implementation`s), the
   implementation coordinates `acme.template/…` and the interfaces `acme.template.Calculator`… (`src/interfaces.ts`, and the
   pipe's `source` and `target`): use your own namespace. A host refuses an import that clashes with a name it has.
3. The tag (`nano-calculator`) in `src/index.ts`: custom element names need a dash.
4. The **Open it in nano** link above: point its `?src=` at your own Pages URL (your `nano.json`). From another origin
   than nano's own, nano opens the Import dialog on it, after which Import is your approval (Cancel imports nothing).

## Develop

```sh
bun install
bun test           # the pods through assemble + Application, the views, the build
bun run build      # dist/: index.js, nano.json
bun run serve      # build, then serve dist/ at http://localhost:4000
```

The host's File › Open… imports a `nano.json` from any URL (code from another origin asks for approval before it runs;
`bun run serve` sets CORS `*` for that); only a `?src=` link must be same-origin: put the build in the host's public
dir (the nano workspace's build already copies it to `/examples/template/`, so link `?src=/examples/template/nano.json`),
or serve the host and `dist/` from one origin. The host fetches the `nano.json`, loads each `modules` entry (relative to the
`nano.json`) and shows the pods. Importing alongside another app whose runtime is also `main` is refused: the names
clash (namespacing comes later).

## What a host gets

- **`dist/nano.json`**: the pods, runtimes and pipes, and `modules`: `{ "acme.template": "./index.js" }`.
- **`dist/index.js`**: the module. Its default export is the provider; its named export `views` maps each
  implementation to its view's tag, and importing it defines the tags. `@pritzlaff/nano-core`, `nano-elements`,
  `nano-ui`, `lit` and `typebox` are left as bare imports: the host provides them through its import map, so there
  is one copy of each.

## Views and looks

A view is a custom element with a `target: { app, registry, runtime, pod }` property. It reaches pods only through
`target.app`: `call(target.runtime, target.pod)`, `listen`, or the runtime's typed client
(`target.app.runtime(target.runtime).get(Iface)`), so it works in any host (`src/view.ts` is the small base it uses). Style with the `--nano-*` tokens (colours, fonts, radius), with fallbacks, so a view takes on any
host's theme; start from `base` and `kit` (`.btn`, `.badge`, `.input-group`…) and the kit's elements
(`<nano-select>`, `<nano-date-picker>`, `<nano-data-table>`, `toast()`…) from `@pritzlaff/nano-elements`.

## Publishing

CI (`.github/workflows/ci.yml`) tests and builds on every push. `pages.yml` publishes `dist/` to GitHub Pages, so
`https://<owner>.github.io/<repo>/nano.json` is the app's URL (a host on that origin can import it).
