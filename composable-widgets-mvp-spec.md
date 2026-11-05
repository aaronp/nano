# Composable Widgets — MVP Specification

## Goal

Build a reusable widget platform with one implementation per widget and three interchangeable delivery modes: build-time dependency, runtime module, and isolated iframe. Demonstrate all three together, including a host embedded as a widget.

## Repository structure

Use a Bun + TypeScript workspace with three primary projects:

| Project | Responsibility | Export repository |
| --- | --- | --- |
| `packages/widget-sdk` | Widget contract, lifecycle, event API, loaders, iframe bridge, test utilities | `widget-sdk` |
| `templates/widget-template` | Cloneable starter, example widgets, build configuration, standalone harness, base tests | `widget-template` |
| `apps/host` | Widget catalogue, dashboard, layout configuration, host-as-widget entry point | `host` |

Keep shared theme assets in `packages/widget-sdk/theme`, with a separate public entry point and export target `widget-theme`. This is a supporting library within the SDK project, not a fourth primary project. Extraction into a separate workspace package is allowed later without changing consumers' imports. Defer additional library boundaries, including the event-bus implementation.

The monorepo is the source of truth. Export repositories are generated distribution repositories; changes originate in the monorepo.

## Widget contract

- Every widget exposes a manifest and `mount(container, context, config)` returning an instance with `update(config)` and `dispose()` methods. Mount, update, and disposal are awaitable.
- The manifest declares widget ID, version, host API compatibility, configuration schema, and available delivery entry points.
- The host assigns unique instance IDs and scoped contexts. Multiple instances of the same widget must work independently.
- Context provides the event client and theme. Keep identity, wallet, and storage services as future extensions.
- Use serializable configuration and event payloads. DOM containers remain local; they never cross the iframe bridge.
- Dispose removes subscriptions, listeners, timers, and child widgets. Failed mounts clean up partially allocated resources.
- Use Lit custom elements for the initial widgets; keep the public mount contract independent of Lit. Custom-element registration must be idempotent. Concurrent incompatible versions of one element are outside MVP scope.

## Build outputs

Each widget build produces:

| Output | Use |
| --- | --- |
| Package entry point and TypeScript declarations | Build-time imports |
| Browser ESM entry point and manifest | Runtime loading from a versioned URL |
| `index.html` | Standalone demonstration and test harness |
| `embed.html` | Iframe entry point using the host bridge |

All outputs use the same widget implementation. Runtime assets must resolve without bare package imports or workspace paths; required styles ship with the widget. Deployments must support repository subpaths and appropriate module CORS responses.

Standalone mode creates a local context. Embed mode waits for a validated host handshake and reports connection failure visibly; it must not silently switch to a disconnected local bus.

## Events and iframe bridge

- The root host owns one logical bus. Inject the client; widgets never create a private bus when hosted.
- Expose asynchronous `publish(event)` and `subscribe(filter, handler)`; subscribe resolves to an unsubscribe handle after registration is acknowledged.
- Event envelopes contain `id`, versioned `type`, `timestamp`, `sourceInstanceId`, `scopeId`, and JSON payload. The host binds source and scope to the connected instance.
- Delivery is transient, with no persistence or replay guarantee. Subscribers receive events published after registration. Do not claim durable or exactly-once delivery.
- Preserve event IDs through bridges; deduplicate bridge echoes within a bounded cache. Catch subscriber errors without stopping other subscribers.
- Use an authenticated-by-origin/source handshake followed by a dedicated MessageChannel. Validate protocol version, message shape, expected origin, and sending window. Include request IDs, timeouts, and teardown on disconnect.
- Same-page widgets are trusted code. Isolated iframe widgets run on distinct origins with a restrictive sandbox. Different GitHub Pages repository paths on one hostname do not provide origin isolation.
- The event viewer observes only its authorised scope. No secrets travel on the bus.

## Theme

Provide shared CSS design tokens and minimal button, panel, and typography styles. Tailwind is optional internal tooling, not the cross-widget contract. Compile styles into widget outputs; do not depend on the host scanning remote source files. Pass serializable theme values to iframe widgets and apply them as CSS custom properties.

## Host and nested composition

- Configure instances using widget ID, delivery mode, source, configuration, and layout position.
- Support adding, removing, and reordering widgets; persist layout configuration locally. Drag-and-drop and a full navigation editor are deferred.
- Build-time instances resolve from an imported registry; runtime instances resolve from approved versioned module URLs; iframe instances resolve from configured embed URLs.
- Isolate load failures in the affected panel and offer retry. Show mode and connection status in the demo.
- Export the host through the same widget contract. Its configuration describes child instances, including widgets compiled into its own registry.
- Top-level bootstrap creates the root context and mounts the host widget. An embedded host consumes its parent's context and creates child contexts; it must not create a disconnected root bus.
- Nested children share the parent event scope by default. Use hierarchical instance IDs; preserve event identity and source through nesting. Do not forward events by republishing them as new events.
- A host containing build-time children must itself load as a runtime module or isolated iframe. Bound nesting depth and reject recursive configurations. Demonstrate one nested level in MVP.
- Disposing a host disposes every descendant and bridge.

## Demo widgets

1. **Event button:** configurable label and JSON payload; publishes `demo.button.clicked.v1` on activation.
2. **Event viewer:** subscribes to its scope; displays timestamp, type, source, ID, and payload; supports filtering and clearing a bounded in-memory list.

Keep both as examples in the template project, with a minimal starter entry point developers can rename. Publish the harness to GitHub Pages so each generated widget repository can be tested independently.

## CI and publishing

- Pull requests run type checks, unit tests, builds, contract tests, and browser integration tests across the workspace.
- A release-tag or manually dispatched GitHub Action exports projects to configured destination repositories using a narrowly scoped GitHub App token or equivalent credential.
- Use an explicit export map for `host`, `widget-sdk`, `widget-template`, and `widget-theme`; allow later library targets.
- Export independently usable source, manifests, build scripts, documentation, and applicable workflows. Resolve workspace dependencies to released package versions; no export may require monorepo-only paths.
- Publishing a repository and publishing an installable package are separate steps. Publish versioned SDK/theme packages to the chosen registry, then export consumers referencing those versions.
- Stage and test exports in clean directories before pushing. Record source commit and release version; preserve published versioned assets. Reruns must be idempotent and report partial failures.
- Configure Pages deployment for the host and template harness. Test iframe isolation using separate origins locally and in the deployed demo.

## Acceptance criteria

- A single dashboard mixes build-time, runtime, and iframe buttons/viewers. Every button's event reaches every subscribed viewer in the shared scope once during normal operation, with matching event ID and source.
- Browser tests cover all nine button/viewer delivery-mode pairings.
- A host with build-time children loads both dynamically and in an isolated iframe; its children exchange events with widgets outside that host.
- Two instances remain independent; removal stops subscriptions; remounting creates no duplicate delivery; disposing a nested host cleans up descendants.
- Invalid handshakes, incompatible API versions, malformed messages, and unavailable modules fail visibly without disabling other panels.
- The standalone harness works without a parent. A fresh template clone builds, tests, and serves its widget using released dependencies.
- Exported repositories install and build independently; release automation produces traceable, repeatable outputs.

## Out of scope

Wallet/key operations, authentication, durable events, plugin marketplace, arbitrary untrusted runtime JavaScript, automatic dependency negotiation, advanced layout editing, and additional SDK sub-library extraction.
