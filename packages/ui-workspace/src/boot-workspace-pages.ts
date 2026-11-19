/** Mounts the saved workspace pages, before <app-shell> reads its routes, and handles Duplicate, Edit, + and Save as. */
import { bootWorkspacePages } from './components/workspace-pages.ts';

bootWorkspacePages(document);
