/**
 * Mounts the saved workspaces' nav items and pages (a module of its own, so it runs before <app-shell> and the dock
 * are defined). Systems aren't saved, so a saved workspace's system is created first if it doesn't exist: its
 * panels then find their registry when the dock restores them. Remembered imports load first, so restored panels of
 * imported kinds find their templates; one that fails is skipped (the drawers say so).
 */
import { Ops } from '@pritzlaff/nano-core'
import { PlatformOps as P, runtimeOf } from '@composable/platform'
import { host } from './composable.ts'
import { bootSavedWorkspaces } from './components/saved-workspaces.ts'
import { savedWorkspaces } from './lib/saved-workspaces.ts'
import { bootImports } from './imports.ts'

for (const system of new Set(savedWorkspaces(localStorage).list().map(ws => ws.system ?? 'host')))
  if (!runtimeOf(host.registry, system)) await host.call({ registry: 'host', instance: 'workspace' }, 'platform', Ops.key(P.createSystem), system)
await bootImports()   // remembered imports first: their kinds are in Main's palette before saved docks copy it
bootSavedWorkspaces(document)
