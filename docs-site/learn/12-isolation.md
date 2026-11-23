# Isolation

A pod you did not write should not run with your page's full access. Its pod says where it runs: `isolation`, absent (or `'host'`) for the host itself, `'sandbox'`, `'isolated-sandbox'` or `'home-origin'` for a frame of its own. Nothing else about the pod changes:

<<< @/../examples/tutorial/12-isolation.ts#deployment

nano has no frames of its own. The **host** (the page or process running the Application) passes `isolate`: given a pod whose isolation is not `'host'`, it gives the implementation to build in its place, with the same coordinate. It is asked once per build, and every message to the pod goes to what it gave:

<<< @/../examples/tutorial/12-isolation.ts#isolate

Without `isolate`, there is nowhere to run it: its first need fails, and so does each call.

<<< @/../examples/tutorial/12-isolation.ts#no-host

## What it prints

```
isolate calculator: sandbox
2 + 3 = 5
{"ok":false,"fail":{"type":"invalid-input","reason":"no host for isolation sandbox"}}
```

## In the nano app

The nano app is such a host. Its stand-in sends each message over a channel to an iframe running the pod's own module, and brings the result back:

- `'sandbox'`: an iframe that may run scripts, on the page's origin;
- `'isolated-sandbox'`: an iframe that may run scripts, on an origin of its own (none of the page's storage);
- `'home-origin'`: the provider's own page in an iframe, so it runs as that site (its passkeys, its storage).

Here a passkey pod runs in a `'home-origin'` frame, its events piped to a log:

<OpenInNano src="examples/originkey/nano.json"/>

Next, [policies](/learn/13-policies): which messages a runtime lets through.
