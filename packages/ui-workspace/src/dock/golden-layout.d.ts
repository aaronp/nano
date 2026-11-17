// golden-layout's ES build: bun runs its CommonJS one otherwise, which needs tslib (undeclared). The package's types.
declare module 'golden-layout/dist/esm/index.js' { export * from 'golden-layout' }
