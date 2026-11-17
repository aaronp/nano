/**
 * Mounts the saved workspaces' nav items and pages (a module of its own, so it runs before <app-shell> and the dock
 * are defined), from the Application's screens (boot-app loaded them, making their systems: panels then find their
 * registry when the dock restores them). Remembered imports load first, so restored panels of imported kinds find
 * their templates; one that fails is skipped (the drawers say so).
 */
import { bootSavedWorkspaces } from './components/saved-workspaces.ts'
import { bootImports } from './imports.ts'
import { restored, startAutosave } from './boot-app.ts'

// remembered imports first: their kinds are in Main's palette before saved docks copy it (a restored working copy already imported its own)
if (!restored) await bootImports()
await bootSavedWorkspaces(document)
startAutosave()
