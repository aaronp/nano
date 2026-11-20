/** Mounts the store's pages, before <app-shell> reads its routes, and handles + and Save as. */
import { pages } from './boot-host.ts';
import { bootWorkspacePages } from './components/workspace-pages.ts';

bootWorkspacePages(document, pages);
