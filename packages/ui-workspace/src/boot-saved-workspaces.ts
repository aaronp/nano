/** Mounts the saved workspaces' nav items and pages (a module of its own, so it runs before <app-shell> is defined). */
import { bootSavedWorkspaces } from './components/saved-workspaces.ts';

bootSavedWorkspaces(document);
