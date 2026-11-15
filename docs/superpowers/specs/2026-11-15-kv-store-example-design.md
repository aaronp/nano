# Step 1: a key/value persistence example

*Agreed with the user on 2026-11-15. Items marked **(my call)** were mine; the user can overturn them.*

## Why

Nano's promise is that an application writes to interfaces and someone else decides what sits behind them. The
first piece to prove that is persistence: a plain key/value contract, one real implementation of it, and a UI that
shows the data behind any implementation. Later steps (a todo app that only calls this contract, cross-origin
import, a `layout` section in `nano.json`) build on it and are **not** part of this step.

This is an **example**, written with nano's concepts. Nothing is added to `@pritzlaff/nano-core`, `nano-elements`
or `nano-ui`: no new export, option or concept. If building it seems to need one, stop and ask the user.

## What gets built

All in `examples/kv-store/` **(my call)**: a self-contained folder inside the existing `examples` package, which
already depends on nano-core and nano-ui. It is shaped like `templates/nano-template` (a provider module, views,
a `nano.json`).

### 1. A plain TypeScript contract (`store.ts`, no nano imports)

```ts
type KvRecord = { key: string; value: string; version: number }
type Written = { version: number } | { conflict: KvRecord | null }   // conflict carries what is stored now
interface KeyValueStore {
  get(key: string): Promise<KvRecord | null>
  put(r: KvRecord): Promise<Written>                       // r.version = the version you read; 0 for a new key
  delete(r: { key: string; version: number }): Promise<Written>
  list(q: { prefix?: string }): Promise<KvRecord[]>        // ordered by key; "query" is a key prefix for now
}
```

- **Optimistic locking:** `put` writes only when `r.version` equals the stored version (0 when absent). It then
  stores `version + 1` and returns it. Otherwise it writes nothing and returns `{ conflict: <stored record or null> }`.
  `delete` checks the version the same way and returns `{ version: 0 }` on success. A key that isn't there counts
  as version 0, so deleting it at version 0 succeeds and does nothing. A conflict is an ordinary value, not a thrown error and not a nano
  failure, so the caller can show it or retry.
- The name is `KvRecord` because `Record` is taken in TypeScript **(my call)**. Values are strings. A typed or
  binary value is a later adapter's job.

### 2. Two classes implementing it (plain TypeScript)

- `IndexedDbStore(database: string)`: one object store, keyed by `key`. Each `put` and `delete` runs its version
  check and write in one readwrite transaction, so two tabs can't both win.
- `MemoryStore()`: a `Map`. It exists for headless tests (Bun has no IndexedDB) and as a second, swappable
  implementation.

### 3. Lifting it into nano (`interfaces.ts`, `provider.ts`)

- A nano interface `example.kv.KeyValueStore` with four actions (`get`, `put`, `delete`, `list`), with TypeBox
  schemas matching the types above.
- One function turns any `KeyValueStore` into handlers (`provide(KeyValueStore, { get: k => success(await s.get(k)), … })`).
  Two implementations use it:
  - `example.kv/indexeddb`: config `{ database: string }`, required.
  - `example.kv/memory`: no config.
- `provider.ts` (no DOM) default-exports `provider('example.kv', [indexeddb, memory])` and exports `views`, which
  maps both implementations to `kv-table`, so headless tests can import it. `index.ts` is the bundle entry: it
  re-exports both and defines the element. The host takes default views from `views`, so `nano.json` needs no
  `views` entry.
- **No `changed` event (my call).** The viewer refreshes from the application stream, as the template's store view
  does today. An event can be added when a pipe needs one.

### 4. `<kv-table>`: a drizzle-style viewer (`kv-table.ts`)

A plain `LitElement` that follows the template's view pattern without importing it, so the example stays
self-contained **(my call)**. It has `target: ViewTarget` and reaches the pod only through `app.call(runtime, pod)`
and `app.listen`. It is built from nano-elements (`nano-data-table`, the kit buttons and
inputs, `base`/`kit` styles) and so follows the workspace's themes.

- **List:** a prefix box, then a table of key, value and version from `list({ prefix })`.
- **Open a row:** the row's key, value and version in an editor. **Save** puts it with the version it was read at.
  **Delete** deletes it at that version.
- **Add:** a new key and value, put at version 0.
- **Conflict:** the editor says the record changed and shows the stored one, which can be reloaded. Nothing is
  overwritten.
- **Refresh:** after any delivered `put` or `delete` to its pod, whoever sent it (the template's `sent`/`delivered`
  pattern).

Because it only calls the interface, it works on anybody's `example.kv.KeyValueStore` pod.

### 5. Deployment and serving

- `examples/kv-store/nano.json`: one runtime `main` with one pod `store`, using `example.kv/indexeddb` with
  `{ "database": "nano-kv-example" }`, and `providers: { "example.kv": "./index.js" }`.
- `examples/package.json` gains `lit` and `@pritzlaff/nano-elements` (workspace) as dependencies **(my call)**.
- The host's build (`packages/ui-workspace/scripts/build.ts`) gains one bundle entry, one copy of `nano.json` and
  one watch path for it, and bundles it to `public/examples/kv-store/` alongside
  the template. It is served from the workspace's own origin, which today's import rule requires.

## How it is proven

- **Headless (`cd examples && bun test --isolate`):**
  - the locking rules on `MemoryStore`: new key, update, stale version, delete, prefix list order
  - the same rules through nano: assemble `nano.json` with `store` switched to `example.kv/memory` and call
    `app.call('main', 'store')`
  - the committed `nano.json` assembles against the provider
- **In a real browser (one Playwright test, `e2e/kv-store.e2e.ts`):**
  - open the workspace at `/?src=/examples/kv-store/nano.json`
  - open `store`'s view
  - add a record, see it listed at version 1
  - edit and save it, see version 2
  - delete it
  - add another record, reload the page, and see it still listed (persisted in IndexedDB). Each Playwright run has a
    fresh browser context, so the database starts empty.
- TypeBox unions and `null` outputs already work through nano (the template's `get` returns `string | null`).
- Existing suites, `bunx tsc --noEmit` and the structure test stay green.

## Not in this step

The todo app; cross-origin import with prompts and policies (the next step); the `layout` section and the
golden-layout dock; adapters, validation and other wrappers; a `kv-check` pod; relational stores; typed or binary
values; a `changed` event.

## Left to the builder

File split inside `examples/kv-store/`, the editor's exact look within nano-elements, and test names.
