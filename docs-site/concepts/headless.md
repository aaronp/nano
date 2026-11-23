# Running it headless

Pods are code and data, not pages, so the whole app runs without a browser. That is how the template tests itself: it loads its own `nano.json` and calls the pods the way any caller would.

Getting the app running takes three steps: a **registry** that holds the provider's implementations, the deployment **assembled** against it (the checks from [Pods](/concepts/pods)), and the **application** created from the result:

<<< @/../templates/nano-template/test/app.ts#open

Each step returns a result rather than throwing; `must` unwraps it, failing the test with the reason if it went wrong. The test also gives the timer a config, `intervalMs: 10`, so it ticks fast.

Then a test calls the pods. `app.call('main', 'timer')` is a client for the `timer` pod in runtime `main`, one method per action:

<<< @/../templates/nano-template/test/pods.test.ts#headless

**When it runs:** `start` builds the timer and starts it. Each `tick` it publishes travels along the pipe in `nano.json` to `store.set`, so the store's `tick` entry keeps up with the count. After `stop` the entry stays where it was: nothing more is published. No pod knows about the test, the store or the pipe; the deployment wired them. The `sleep`s are there because a caller doesn't wait for what a pipe delivers: the ticks and their deliveries happen after `start` returns.

Run it in the template with `bun test`. `app.listen(fn)` shows every message the application carries, if a test wants to watch them.

The model's definition: `design.md` (`Application`, `AppDeployment`) in the nano repository.
