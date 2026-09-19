# lexical-review

Track-changes review mode for [Lexical](https://lexical.dev/). Pending proposals live as proposal-bearing Lexical nodes in the current `EditorState` and render as review markers alongside accepted content.

[Try the live demo](https://mahendrimd.github.io/lexical-review/) · [View the npm package](https://www.npmjs.com/package/lexical-review) · [Report an issue](https://github.com/mahendrimd/lexical-review/issues)

This guide walks through installation, editor integration, and API usage.
Start with [installation](#installation), choose an [entrypoint](#entrypoints),
then follow the [core loop](#core-loop) to open and register a session.

For editing rules and resolution effects, see the
[proposal behavior contract](https://github.com/mahendrimd/lexical-review/blob/main/docs/proposal-behavior.md).
For implementation responsibilities and state ownership, see the
[architecture](https://github.com/mahendrimd/lexical-review/blob/main/ARCHITECTURE.md).

## Installation

```bash
npm install lexical-review \
  'lexical@>=0.47.0 <0.51.0' \
  '@lexical/react@>=0.47.0 <0.51.0' \
  '@lexical/clipboard@>=0.47.0 <0.51.0' \
  '@lexical/utils@>=0.47.0 <0.51.0' \
  react react-dom
```

## Compatibility

The package declares Lexical peer compatibility `>=0.47.0 <0.51.0`.
`lexical`, `@lexical/react`, `@lexical/clipboard`, and `@lexical/utils` must
be installed at the same version within that range.

The package declares React peer compatibility for React 18 and React 19, and
`react` and `react-dom` must use the same version. All declared peers are
required at installation, including the React peers for consumers using only
the root entrypoint.

CI exercises the supported Lexical minors and browser boundary scenarios in
Chromium, Firefox, and Playwright WebKit. Playwright WebKit results do not
certify native Safari or iOS Safari.

## Entrypoints

| Entrypoint              | Purpose                                                      | Example exports                                |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| `lexical-review`        | Core nodes, document and session APIs, and review operations | `ReviewInsertionNode`, `openReviewSession`     |
| `lexical-review/client` | Browser editor registration and React integration            | `registerReviewSession`, `ReviewSessionPlugin` |

The root entrypoint has no runtime imports of `react` or `@lexical/react` and
is suitable for server-side model and serialization code. DOM rendering and
editor registration require a client environment.

For browser integration, call `registerReviewSession` with a `LexicalEditor`
from plain JavaScript, Vue, Svelte, or another framework. React hosts can use
`ReviewSessionPlugin`, which manages registration and cleanup through an
effect. Both exports share the client entrypoint, whose runtime imports include
`react` and `@lexical/react` even when calling `registerReviewSession` directly.

## Core loop

Open a validated native v3 review document against an editor, register the session, then inspect or resolve proposals by ID:

```ts
import {
  $inspectReviewProposal,
  $resolveReviewProposal,
  $resolveReviewProposals,
  openReviewSession,
} from "lexical-review";
import { registerReviewSession } from "lexical-review/client";

const session = openReviewSession(editor, initialDocument);
if (session.status !== "valid") {
  throw new Error(session.issues[0]?.message ?? "Invalid review document.");
}
const cleanup = registerReviewSession(editor, session.value, { onOutcome });
// ... later: cleanup();

editor.getEditorState().read(() => $inspectReviewProposal(proposalId));
// Returns a kind-tagged proposal: insertion, deletion, replacement,
// formatting, structure, or fragment.

editor.update(() => $resolveReviewProposal(proposalId, "accept"));
// Alternatively: "reject" or "remove", each inside editor.update().
editor.update(() => $resolveReviewProposals(ids, "accept"));
// Batch variant: validates every ID before mutation, resolves each once.
```

Opening validates before installing any state. The session reads and updates
the live `EditorState`; it does not keep a parallel authoritative snapshot.
Serialization preserves current pending proposals only, with no resolution
history.

Register the session with the same editor that opened it, and call the returned
cleanup function when detaching it. In React, use
`<ReviewSessionPlugin session={session.value} />` inside that editor's
`LexicalComposer` to manage this lifecycle.

Through a registered session, proposal resolution is also available as
`RESOLVE_REVIEW_PROPOSALS_COMMAND` with payload `{ ids, action }`.

Unexpected implementation errors propagate to Lexical's update error handling and rollback; do not swallow them inside the update callback.

### Registration options

The default calls need no options: proposal IDs are generated, deletion is by character, and copy exports the all-accepted projection. Hosts that need more pass them to the registration:

```ts
registerReviewSession(editor, session.value, {
  copyProjection: "accepted-state", // or "all-accepted" (default)
  onOutcome, // a claimed command may still report `refused`; plus onInsertionOutcome / onDeletionOutcome
});
```

A custom `proposalIdFactory` is only needed when an external scheme owns identity, such as server-assigned IDs or deterministic tests. In that case, pass the same factory to the registration and to each direct call, so typed and programmatic proposals share one scheme:

```ts
// Custom-scheme hosts only:
const proposalIdFactory = () => crypto.randomUUID();
editor.update(() => {
  $insertReviewText("new text", { proposalIdFactory });
});
```

Custom factories must return unique, valid IDs; duplicates, invalid identities, and factory failures are refused before mutation.

## Authoring operations

Call these inside `editor.update()`. The client route sends typing, deletion, formatting, Enter, clipboard, and composition input through the same operations. Behavior details (continuation, neighbor targeting, caret placement, refusals) are in the [behavior contract](https://github.com/mahendrimd/lexical-review/blob/main/docs/proposal-behavior.md).

| Operation                                                                       | Use                                                                                                         |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `$insertReviewText(text, options?)` / `$replaceReviewText(text, options?)`      | Insert, replace, or delete a text range; selecting accepted text creates a replacement under one ID         |
| `$deleteReviewText(backward, options?)`                                         | Delete at the selection; `granularity` is `"character"` (default) or `"word"`                               |
| `$setReviewFormatting(value)` / `$toggleReviewFormatting(property)`             | Propose `bold`, `italic`, `underline`, or `strikethrough` on accepted text; register `ReviewFormattingNode` |
| `$splitReviewParagraph(options?)` / `$mergeReviewParagraph(backward, options?)` | Propose a paragraph split or merge; register `ReviewBoundaryNode`                                           |
| `$insertReviewFragment(paragraphs, options?)`                                   | Insert normalized `{ runs, emptyFormat? }` paragraphs as one atomic proposal; register `ReviewFragmentNode` |
| `createReviewPreview(document, "accepted-state" \| "all-accepted")`             | Read-only detached preview; an indeterminate all-accepted projection throws                                 |

```ts
editor.update(() => {
  const outcome = $insertReviewText("new text");
  // Handle changed, unchanged, or refused outcomes.
});
```

```ts
$insertReviewFragment([
  { runs: [{ text: "x", format: 1 }] }, // format bitmask: bold 1, italic 2, strikethrough 4, underline 8
  { runs: [{ text: "y", format: 0 }] },
]);
```

`INSERT_REVIEW_FRAGMENT_COMMAND` from `lexical-review/client` accepts already-normalized fragment content.

## Rendering contract

For inserted and deleted text, the review marker is always the outermost DOM element. Lexical formatting and inline styles are nested inside the marker, for example: `<ins><strong>inserted text</strong></ins>`. A pending merge displays `¶` inside `<del data-review-boundary="merge">`.

## Clipboard

- Copy and cut export content only (`text/plain` and `text/html`) with no proposal identity. Defaults to `copyProjection: "all-accepted"`; opt in to `"accepted-state"` when needed. See [clipboard projections](https://github.com/mahendrimd/lexical-review/blob/main/docs/proposal-behavior.md#clipboard-projections) for what each mode includes.
- Paste and copy-style drop insert through the same single-paragraph or atomic-fragment operations. Foreign markup never gains proposal identity.

## Interchange

The [`lexical-review-wer` package](https://github.com/mahendrimd/lexical-review/blob/main/packages/lexical-review-wer/README.md) owns the WER export boundary. Its guide describes the current export limitation; general import/export mapping is unimplemented.
