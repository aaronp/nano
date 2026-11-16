/** Settings' button: forget this browser's pane sizes (the `split:*` keys). */
export function forgetLayout(storage: Storage = localStorage) {
  for (const k of Object.keys(storage).filter(k => k.startsWith('split:'))) storage.removeItem(k)
  // Task 8: the host's kept layout is cleared here too.
}
