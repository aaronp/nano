# @pritzlaff/nano-ui

The `nano.ui` provider over `@pritzlaff/nano-core`: input, debounce, map and log pods, the `HostUI` interface a host
implements, `importApp`, and the views (explorer, wiring, pod view).

```ts
import uiProvider from '@pritzlaff/nano-ui'
registry.add(uiProvider)
```

## Trust

A `nano.json` is code: it names modules the host loads and runs. Import only what you trust. `nano.ui/map` compiles its
config with `new Function`, so a host needs a CSP that allows `'unsafe-eval'`.
