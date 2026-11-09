/** Imports that failed to load at start-up. Kept here (not only told as an event), since start-up imports run
 * before the drawers that list them exist. */
export type ImportFailure = { url: string; error: string };
let failures: ImportFailure[] = [];
export const importFailures = () => failures;
/** Records the failures and tells anyone listening (`imports:failed`), such as drawers already built. */
export function setImportFailures(list: ImportFailure[]) {
  failures = list;
  document.dispatchEvent(new CustomEvent('imports:failed', { detail: list }));
}
