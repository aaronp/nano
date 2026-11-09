/**
 * Entry point. The theme is applied first (boot-theme), then components register and upgrade the page.
 * The workspace registers last so the drawer's "add widget" links exist when it wires them up.
 */
import './boot-theme.ts';
import './composable.ts';
import './boot-saved-workspaces.ts';   // saved workspaces' routes exist before <app-shell> reads them
import './components/app-shell.ts';
import './components/split-pane.ts';
import './components/component-drawer.ts';
import './components/theme-picker.ts';
import './components/puzzle-prototype.ts';
import './components/puzzle-port.ts';
import './widgets/widgets.ts';
import './widgets/notes-panel.ts';
import './components/workspace-dock.ts';
