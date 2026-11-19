# Input kinds and the animated debounce — design

Date: 2026-11-18. Restores two things lost when `packages/bundle` was retired in `5f9b8d2` ("one stack"), ported onto
today's `nano.ui` pods and views. The old code is the reference: `git show 5f9b8d2^:packages/bundle/src/…`
(`components/input.ts`, `components/debounce.ts`, `elements/elements.ts` InputEl, `elements/debounce-el.ts`,
`elements/debounce-model.ts`).

## Intent

**Debounce.** The user wants the animated debounce view back. Queued values ride a switchback track, then drop through a
hatch as a batch into buckets that slide along as history, coloured by value type. Its **quiet** and **max wait**
settings are sliders.

**Input.** The user wants input kinds back (text, textarea, number, boolean), and the input to publish on every edit, not
only on submit.

## Decided (user, 2026-11-18)

- **`Debounce` gets both events.** `flushed` keeps today's meaning, the newest value. A new `batch` event carries
  everything queued since the last flush, oldest first, as an array. Both are published at the same flush.
- **`Input` gets one new op, `change`, called on every edit.** Like `submit`, it is an action that returns its input, so
  its result can be piped.

## Interface and config changes (nano.ui; approved above)

- **`Debounce` interface:**
  ```ts
  { push: action(Any, Nothing), flushed: event(Any), batch: event(Entries) }
  ```
- **`nano.ui/debounce` config:** `{ quietMs, maxWaitMs? }`, both integers from 0 to 60000.
  - A flush happens after `quietMs` without a push, or at the latest `maxWaitMs` after the first push of a batch, when
    `maxWaitMs` is set.
  - Without a config the defaults are quietMs 300 and no max wait, as today.
- **`Input` interface:**
  ```ts
  { submit: action(Any, Any), change: action(Any, Any) }
  ```
- **`nano.ui/input` config:** `{ kind?: 'text' | 'textarea' | 'number' | 'boolean' }`, default `text`. The pod itself
  ignores `kind`; it is for the view.
- `design.md` doesn't list nano.ui ops, so no design.md change is needed unless a new nano-core export appears. None
  does.

## Views

- **`nano-input`, the old InputEl's behaviour, keyed by config `kind`:**
  - **Text and number:** an `<input>`. Enter submits.
  - **Textarea:** Ctrl/Cmd+Enter submits.
  - **Boolean:** a checkbox, and ticking it submits.
  - Every edit calls `change` with the parsed value: a number for number, a boolean for boolean.
  - There is a Send button.
  - A kind `<select>` changes the pod's config by applying the deployment with the new config, the same way the
    deployment is changed elsewhere. Applying restarts the pod, which is fine because it holds no state.
- **`nano-debounce`, a port of `debounce-el.ts` and `debounce-model.ts`:**
  - **Data source:** it hears values by `app.runtime(runtime).subscribe(port(Debounce, push), …)`, which gives each
    push's `{ input }`. It knows a flush has happened from the `sent` event the pod emits from `flushed`/`batch`.
  - **Animation:** it keeps the queue itself, with each value and its arrival time. On a flush it drops that queue
    through the hatch, labelled quiet or max wait.
  - **Sliders:** quiet and max wait. Moving one applies the pod's new config on release, not on every pixel.
  - **Fit:** it scales to the panel, as the old view did.
  - Pure geometry and motion stay in a model file, testable without a DOM.

## Non-goals

- Range, filter and the old code view are not part of this.
- Key events: `change` covers typing.
- Changing the slice example: its `wait → up` pipe still uses `flushed`, the last value.

## Constraints

- Files must stay at or under 150 lines.
- Tests:
  - `cd packages/ui && bun test --isolate`
  - the workspace, examples and nano suites
  - `bunx tsc --noEmit`
- Check in a real browser via the workspace build (slice example).
