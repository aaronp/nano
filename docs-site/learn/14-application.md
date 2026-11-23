# The Application

The Registry is what can be made; a Runtime is pods placed together. The **Application** is the one live thing: it builds the pods, delivers every message, and changes what runs when it is given a new deployment. A runtime's policy is its yes or no on each message; the Application's **deployment policy** is its yes or no on each new deployment:

<<< @/../examples/tutorial/14-application.ts#policy

- It is asked who applies (`caller`: `'host'` unless `apply` names one) and the whole deployment they want.
- `listen` hears the Application's one stream: `built`, `sent`, `delivered`, `denied`, `applied`, … Here, only `applied`.

The calculator started alone. The next deployment adds a history, piped from `calculated` (as in [a pipe](/learn/09-pipe)):

<<< @/../examples/tutorial/14-application.ts#apply

- `app.deployment()` is a copy of the deployment now, plain data.
- `apply` checks the new deployment against the Registry, then asks the policy; refused, nothing changes.
- Allowed, it closes the pods removed or changed, builds the eager ones added or changed at once (a lazy one on its first need), and leaves the rest running: the calculator is the same build.

<<< @/../examples/tutorial/14-application.ts#use

## What it prints

```
{"ok":false,"fail":{"type":"denied","reason":"calculator may not deploy"}}
applied by host: added history
{"ok":true}
[{"a":2,"op":"+","b":3,"result":5}]
```

Next, [an app gateway](/learn/15-gateway): two runtimes, one bridge.
