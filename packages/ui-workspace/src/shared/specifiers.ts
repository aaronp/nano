/** The libraries the host shares with the packages it imports: each is built as public/shared/<file>.js (split
 * from main.js, so there is one copy) and named in index.html's import map. A package may import only these. */
export const SHARED = [
  { specifier: '@pritzlaff/nano-core', file: 'nano-core' },
  { specifier: '@pritzlaff/nano-runes', file: 'nano-runes' },
  { specifier: '@pritzlaff/nano-elements', file: 'nano-elements' },
  { specifier: 'lit', file: 'lit' },
  { specifier: 'lit/decorators.js', file: 'lit-decorators' },
  { specifier: 'lit/directive.js', file: 'lit-directive' },
  { specifier: 'lit/directives/class-map.js', file: 'lit-class-map' },
  { specifier: 'lit/directives/style-map.js', file: 'lit-style-map' },
  { specifier: 'lit/directives/repeat.js', file: 'lit-repeat' },
  { specifier: 'lit/directives/if-defined.js', file: 'lit-if-defined' },
  { specifier: 'typebox', file: 'typebox' },
  { specifier: 'typebox/value', file: 'typebox-value' },
] as const
