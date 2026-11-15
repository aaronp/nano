# ui-workspace

The host: one `@pritzlaff/nano-core` `Application`, with its own pod `ui` (`workspace.host/ui`, the `HostUI` of
`@pritzlaff/nano-ui`) in runtime `main`.

- **Built-ins:** the `nano.ui` implementations; choosing one adds a pod `<kind><n>` to `main`.
- **Connect:** a source pod and op, a target pod and op; applies a pipe.
- **Explorer, view, wiring, stream:** `<nano-explorer>`; the opened pod's view (`viewFor`), with a view picker and a
  "Change implementation" picker; `<nano-wiring>`; the last 200 events.
- **File:** Import URL (`importApp`, then `apply`; `?src=<url>` does the same on load) and Save (`nano.json`, without
  the host pod `ui`). A failure is a toast and changes nothing.

`bun run build` writes `public/`: `main.js`, the shared libraries in `shared/` and `bundle/nano-ui.js` (named in
`index.html`'s import map, so imported modules share them), and the slice example in `examples/slice/`.
`make ui` (from the repo root) builds and serves it; try `/?src=/examples/slice/nano.json`.

```
src/host.ts      the Application, what is loaded, import, apply, save
src/host-ui.ts   workspace.host/ui: alert (toast), approve (<dialog>), setAppBar (the title)
src/shell.ts     <workspace-shell>: the panels
src/lib, src/components/{split-pane,theme-picker}.ts, src/boot-theme.ts   themes and split panes
```

## Trust

A `nano.json` is code: it names modules the host loads and runs. Import only what you trust. `nano.ui/map` compiles its
config with `new Function`, so a host needs a CSP that allows `'unsafe-eval'`.
