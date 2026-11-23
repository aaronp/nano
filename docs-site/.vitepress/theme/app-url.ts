/** The app's URL that imports `src` on load: the app root is the docs `base` without its trailing `docs/`. */
export const appUrl = (base: string, src: string) => `${base.replace(/docs\/$/, '')}?src=${src}`
