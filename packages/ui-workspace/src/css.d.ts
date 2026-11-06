/** esbuild bundles .css imports as text (--loader:.css=text); the dock injects them once. */
declare module '*.css' {
  const text: string;
  export default text;
}
