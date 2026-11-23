# Isolation

Code you import runs in the host's page unless you say otherwise, with everything the page can reach. A pod's `isolation` says where its code runs instead. It is one field on the pod, so the same pod can run in the page or apart from it without changing its code or its wiring.

This example runs a passkey pod as its own website, so the passkeys it makes belong to the site that serves it, not to whichever app imports it:

<<< @/../examples/originkey/nano.json

- `originKey` is `"isolation": "home-origin"`, and `frames` names the page it runs in, served beside the module.
- `keyLog` (a built-in log) has no `isolation`, so it runs in the page as usual.
- The pipe sends `originKey`'s `authenticated` event to `keyLog`, exactly as it would between two pods in the page.

## The four values

nano itself only checks the value; the host decides what it means. In the nano app:

| `isolation` | Where the pod's code runs |
| --- | --- |
| `host` (or none) | in the page, with its full access |
| `sandbox` | in a frame, but on the page's own origin, so with the page's access |
| `isolated-sandbox` | in a frame with no origin of its own: no access to the page's storage or session |
| `home-origin` | in a frame loaded from its provider's own page (`frames`), as that site: its storage and passkeys |

Importing with **Sandboxed** (File › Open…, [In the host](/concepts/host)) makes a new provider's pods `isolated-sandbox`; **Trusted** keeps what the file says. A `home-origin` pod stays one either way.

## What changes, and what does not

The host gives an isolated pod a stand-in with the same implementation, interfaces and config, whose calls and events cross into the frame. So calls to it, its events, the pipes from it and its place in the deployment are the same as before; only where its code runs changes. Its view runs in the frame too.

A host that doesn't run frames can't run such a pod: without one, the pod fails to build. The example's own test runs it headless by removing `isolation` first.

**When it runs:** opening it adds the passkey pod and the log. The pod's view, with its Register and Passkey buttons, runs in the frame, so a passkey it registers is the serving site's; each sign-in it makes reaches the log through the pipe.

<OpenInNano src="examples/originkey/nano.json"/>

The model's definition: `design.md` (`Pod`, its `isolation`) in the nano repository.
