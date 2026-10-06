# lexical-review

`lexical-review` adds review mode (also known as track changes) to [Lexical](https://lexical.dev/). It keeps original, inserted, and deleted text in the Lexical editor state and renders review markers in the DOM.

[Try the live demo](https://mahendrimd.github.io/lexical-review/) · [Read the package documentation](packages/lexical-review/README.md) · [View the npm package](https://www.npmjs.com/package/lexical-review)

## Features

- Node-backed v3 review session with stable proposal identity on creation.
- Pending insertion, deletion, replacement, formatting, paragraph split/merge, and atomic document-fragment proposals.
- Explicit accept, reject, and removal operations with no terminal history.
- No-mutation refusals that preserve content, pending work, projection, and selection.
- Content-only clipboard projections; untrusted clipboard content never confers proposal identity.
- Lexical formatting and inline styles are preserved inside review markers (`<ins>`/`<del>` outermost).
- Native review documents serialize accepted content plus current pending proposals only.

See the [proposal behavior contract](docs/proposal-behavior.md) for proposal kinds, editing rules, and resolution effects.

## Getting started

Start with the [package guide](packages/lexical-review/README.md):

1. [Install the package and its peers](packages/lexical-review/README.md#installation).
2. [Add the extension and open a review document](packages/lexical-review/README.md#quick-start).
3. [Configure review input](packages/lexical-review/README.md#configuration) and [handle outcomes](packages/lexical-review/README.md#handling-outcomes).
4. [Author proposals](packages/lexical-review/README.md#authoring-operations).
5. [Inspect, navigate, and resolve proposals](packages/lexical-review/README.md#reviewing-proposals).

The [live demo](https://mahendrimd.github.io/lexical-review/) lets you explore
review interactions before integrating them into your application.

## Documentation

| If you want to…                           | Read                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Integrate review mode into an application | [Package guide](packages/lexical-review/README.md) — installation, session lifecycle, and API usage     |
| Understand what editing and resolution do | [Proposal behavior](docs/proposal-behavior.md) — proposal kinds, editing rules, and observable outcomes |
| Understand or change the implementation   | [Architecture](ARCHITECTURE.md) — state ownership, interaction lifecycle, and guarantees                |
| Clarify a domain term                     | [Vocabulary](GLOSSARY.md) — shared definitions and distinctions                                          |
| Work with WER interchange                 | [Interchange package](packages/lexical-review-wer/README.md) — current export boundary and limitations  |
| Understand a recorded design decision     | [Architecture decisions](docs/adr/) — lasting choices and their rationale                               |

## Development

The library lives in `packages/lexical-review`, the demo lives in `packages/demo`, and focused tests are co-located with the library source. The repository requires Node `^22.22.2`, `^24.15.0`, or `>=26.0.0` and pnpm `12`.

```bash
pnpm install
pnpm dev                         # start the demo
pnpm test --run                  # run unit tests
pnpm test:package                # build and verify the published package API
pnpm test:e2e                    # run Playwright tests
pnpm build:demo                  # build the demo
pnpm --filter lexical-review build
pnpm lint
pnpm compatibility               # run configured Lexical compatibility checks
pnpm release:dry-run             # verify the packed release artifact without publishing
```

Contributions and issue reports are welcome. Please include a focused reproduction or test when changing review behavior.
