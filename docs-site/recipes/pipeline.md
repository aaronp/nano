# A pipeline of built-ins

A pipeline built only from the host's own pods, with no code of yours: what you type is debounced, upper-cased and logged. It is all in a `nano.json`:

<<< @/../examples/slice/nano.json

- `in` (`nano.ui/input`) answers `submit` with what was typed. A pipe can carry an action's results as well as an event, so its first pipe sends each submit to `wait`.
- `wait` (`nano.ui/debounce`) waits until `quietMs` pass without a new value, then publishes the newest as `flushed`.
- `up` (`nano.ui/map`) runs its `code` on each value, here `return String(x).toUpperCase()`; its results go on to `out`.
- `out` (`nano.ui/log`) keeps what it is sent.

Each step only knows its own interface; the pipes connect them ([Wiring](/concepts/wiring)). The `example.slice` module offers one more implementation of the map interface, which the pipeline can switch `up` to.

**When it runs:** open `in`'s panel, type `hi` and press Enter; open `out`'s panel: it shows `HI`. Choose `example.slice/shout` in `up`'s Change implementation, and the next submit logs `hey!` for `hey`, with nothing else changed.

<OpenInNano src="examples/slice/nano.json"/>
