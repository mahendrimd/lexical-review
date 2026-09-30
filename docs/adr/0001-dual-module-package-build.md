# Dual-module package build

The published `lexical-review` package retains separate ESM and CommonJS builds to preserve its consumer contract across the declared Lexical peer range. Rolldown bundles the runtime entrypoint to ESM `.mjs` and CommonJS `.js` files, while TypeScript emits the `.d.ts` declarations. The package intentionally omits `"type": "module"` and keeps internal TypeScript imports extensionless so the generated declarations remain compatible with NodeNext consumers, while the export map selects the correct runtime for `import` and `require`.

This layout originally followed Lexical's dual-module architecture. Starting with Lexical 0.51, [upstream PR #9127](https://github.com/facebook/lexical/pull/9127) publishes ESM only and preserves CommonJS consumers through Node's synchronous `require(esm)` support. Our CommonJS build can load those ESM dependencies on a compatible runtime; matching upstream's output format is not required. Publishing our own CommonJS build does not make Lexical 0.51 or later loadable through `require()` on older Node runtimes.

Package contract tests cover ESM and CommonJS runtime loading and NodeNext declaration resolution. Changes to the export map, runtime output, or declarations must preserve these consumer contracts.

An ESM-only migration may simplify the build later, but must evaluate consumer runtime requirements, the declared peer range, NodeNext declaration resolution, and package contract coverage together. Treat it as a separate migration with an explicit semver assessment.

## Considered options

- Publish ESM only with `"type": "module"` and `.js` output: this now matches Lexical 0.51 and later and simplifies runtime output, but requires explicit file extensions in generated declaration imports and makes CommonJS consumers rely on runtime ESM interop. Retain both builds for the existing consumer contract.
- Let TypeScript emit runtime JavaScript and declarations: this does not provide the intended dual ESM/CommonJS output layout.
