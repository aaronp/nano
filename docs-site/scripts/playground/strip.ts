/** The code as the reader should run it: without the `// #region` / `// #endregion` lines the docs embed by. */
export const stripMarkers = (src: string) => src.replace(/^[ \t]*\/\/\s*#(?:end)?region\b.*\n?/gm, '')
