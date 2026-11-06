/** Imported first by main.ts so the theme is on <html> before any component upgrades. */
import { applyChoice, followSystem, loadChoice } from './lib/theme-state.ts';

applyChoice(document, loadChoice().choice);
followSystem(document);
