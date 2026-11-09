# @composable/bundle

Basic components to wire together. Each is a rune component plus a self-placing element:
`<c-input name="q">` places (or attaches to) the instance `q` in the provided registry.

| Component | Element | Takes | Publishes |
|---|---|---|---|
| `Input` | `<c-input>` | `set-kind` (text, textarea, number, boolean), `set-value`, `submit` | `submitted` (on Enter, or Ctrl/Cmd+Enter in a text area) |
| `Range` | `<c-range>` | `set` (clamped), `set-bounds` | `value` |
| `Log` | `<c-log>` | `debug`, `info`, `warn` (any value), `clear` | `entries` |
| `Debounce` | `<c-debounce>` | `enqueue`, `set-quiet`, `set-max-wait` | `flushed`: the queued values as one array, after `quiet` ms without input or at most `maxWait` ms after the first |
| `Map` | `<c-map>` | `set-code`, `map(x)` | `mapped` |
| `Filter` | `<c-filter>` | `set-code`, `filter(x)` | `passed`: only the values the code passes |

`catalog` maps each kind to its component, for whatever creates components by name, such as the platform.

**Map and Filter run what is typed into them** as `new Function('x', code)`. That's fine for a local playground,
and never for untrusted input.
