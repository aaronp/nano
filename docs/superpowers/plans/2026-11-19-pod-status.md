# Pod Status Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accurate pod status in the Systems view from a nano-core query, with the display (icons) in ui-workspace.

**Architecture:**
- **nano-core:** remembers each pod's lifecycle and answers `runtime(id).status(pod)`.
- **The explorer (nano-ui):** asks for each pod's status on render, and again after each lifecycle event; it keeps no
  status of its own.
- **Icons:** kind icons and status dots are workspace display. The explorer takes an optional `icon` renderer, which it
  passes through to `nano-tree`; the workspace supplies one.

**Tech Stack:** TypeScript, Lit, bun test (`--isolate`), happy-dom.

**Spec:** this conversation's decisions (user, 2026-11-19). The base is
`docs/superpowers/specs/2026-11-19-shared-filter-design.md`, revised as below.
- **Option A:** a status query on a runtime.
- **Separation:** keep the display of nano components separate from the nano API; the icons live in ui-workspace.

## Global Constraints

- **The nano-core change:**
  - `RuntimeView.status(pod: string): NanoResult<PodStatus>`. It answers `not-found` for a pod not placed in that
    runtime.
  - `PodStatus = 'running' | 'not started' | 'stopped' | 'failed'`, exported from nano-core.
  - Both go in design.md.
  - `Application` stays at 10 members; `RuntimeView` must stay at 10 members or fewer.
- **Status meaning:**
  - `running`: an instance is built.
  - `not started`: placed, but never built, or a lazy pod restarted and not yet rebuilt.
  - `stopped`: closed, and not rebuilding.
  - `failed`: its last build failed. A call that throws or times out is not a failed pod.
  - An eager pod rebuilding after a restart is `running` once built.
- **nano-ui:**
  - Remove `podStatus`. `PodStatus` is re-exported from nano-core, not redefined.
  - Remove `kindIcon` and `statusDot` from nano-ui; move `icons.ts` to ui-workspace.
  - `<nano-explorer>` gains an optional `icon?: (n: TreeNode) => unknown`, passed through to `nano-tree`. Pod nodes
    carry `data.status`.
  - `emptyFilter`, `matches`, `filterTree`, `FilterValue` and `NanoFilter` stay.
- **Size and rules:** files at most 150 lines; headless first; theme tokens only.
- **Tests:**
  - `cd packages/nano && bun test --isolate`
  - `cd packages/elements && bun test --isolate`
  - `cd packages/ui && bun test --isolate`
  - `cd packages/ui-workspace && bun test --isolate`
  - `bunx tsc --noEmit`
  - `cd packages/ui-workspace && BUN_TMPDIR=$TMPDIR bun run build`
- **Commits:** on `dev-raft-template` with `git commit --only <paths>`, ending
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A call that throws:** after an op throws on a built pod, `status` is still `running` (Task 1).
2. **Restarting:** a lazy pod restarted reads `not started` until called; an eager one reads `running` once rebuilt
   (Task 1).
3. **Removing and re-adding:** a pod removed by `apply`, then placed again under the same name, reads its new state,
   not the old one (Task 1).
4. **Failing then succeeding:** a pod whose build failed reads `failed`; after a successful rebuild (restart, or an
   apply changing it), `running` (Task 1).
5. **Opening the view late:** the explorer opened after pods were built shows their true status with no events
   (Task 2).

---

### Task 1: nano-core — remember each pod's lifecycle; `runtime(id).status(pod)`

**Files:**
- Modify:
  - `packages/nano/src/application/instances.ts` (or a small new `application/status.ts` if `instances.ts` would pass
    150 lines);
  - `resolve.ts` (`RuntimeView`);
  - `index.ts`;
  - `design.md`.
- Test: `packages/nano/test/pod-status.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `lazy: not started until called, then running`;
  - `eager: running after create`;
  - `a call that throws leaves it running` (Review Focus 1);
  - `a build that throws: failed; a restart that builds: running` (Review Focus 4);
  - `restart: lazy → not started; eager → running once rebuilt` (Review Focus 2);
  - `closed by apply → not-found; placed again → its new state` (Review Focus 3);
  - `a pod not placed in that runtime → not-found`;
  - `after app.close(): stopped`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Record the state where instances are built and closed; restate nothing.
- [ ] **Step 4:** Run all suites and `tsc`. Expected: PASS, including the structure test.
- [ ] **Step 5:** Commit `feat(core): a runtime answers each pod's status — running, not started, stopped or failed`.

### Task 2: The explorer asks nano-core; icons move to the workspace

**Files:**
- Modify:
  - `packages/ui/src/explorer.ts` and `explorer-nodes.ts`: ask `t.app.runtime(r).status(pod)` when building nodes;
    re-render on each `built`, `closed`, `restarted`, `failure` and `applied` event; drop the `states` fold; add the
    `icon` pass-through;
  - `packages/ui/src/filter/model.ts` and `index.ts`: remove `podStatus` and the local `PodStatus`; re-export nano-core's;
  - move `packages/ui/src/filter/icons.ts` to `packages/ui-workspace/src/icons.ts`, together with its tests;
  - the workspace (where it mounts or hands targets to `nano-explorer`): set `icon` to its renderer (status dot then
    hexagon for pods, kind icon otherwise);
  - `design.md`.
- Test:
  - extend `packages/ui/test/explorer.test.ts`;
  - `packages/ui-workspace/test/icons.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `opened after pods were built, the explorer shows their real status` (Review Focus 5);
  - `a throwing call leaves the pod running in the tree`;
  - `the explorer passes icon through to nano-tree`;
  - `the workspace renderer: a pod shows its status dot and hexagon`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all suites, `tsc` and the build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(ui): the Systems tree asks nano-core for pod status; icons are the workspace's`.
