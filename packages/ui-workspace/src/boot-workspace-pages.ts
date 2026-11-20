/** Mounts the store's pages, before <app-shell> reads its routes, and handles + and Save as. Main's dock gets the host
 * first (before it is defined), so its panels open with it; the other docks take it from Main's. */
import { host, pages } from './boot-host.ts';
import { bootWorkspacePages } from './components/workspace-pages.ts';
import type { WorkspaceDock } from './components/workspace-dock.ts';

const main = document.querySelector<WorkspaceDock>('workspace-dock#workspace');
if (main && host) main.host = host;
bootWorkspacePages(document, pages);
