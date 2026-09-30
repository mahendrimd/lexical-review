# lexical-review

Track-changes review mode for [Lexical](https://lexical.dev/). Pending proposals live as proposal-bearing Lexical nodes in the current `EditorState` and render as review markers alongside accepted content.

[Try the live demo](https://mahendrimd.github.io/lexical-review/) · [View the npm package](https://www.npmjs.com/package/lexical-review) · [Report an issue](https://github.com/mahendrimd/lexical-review/issues)

This guide walks through installation, editor integration, and API usage.
Start with [installation](#installation), then follow the [core loop](#core-loop)
to open a session through the extension.

For editing rules and resolution effects, see the
[proposal behavior contract](https://github.com/mahendrimd/lexical-review/blob/main/docs/proposal-behavior.md).
For implementation responsibilities and state ownership, see the
[architecture](https://github.com/mahendrimd/lexical-review/blob/main/ARCHITECTURE.md).

## Installation

```bash
npm install lexical-review \
  'lexical@>=0.47.0 <0.53.0' \
  '@lexical/clipboard@>=0.47.0 <0.53.0' \
  '@lexical/extension@>=0.47.0 <0.53.0' \
  '@lexical/utils@>=0.47.0 <0.53.0'
```

## Compatibility

The package declares Lexical peer compatibility `>=0.47.0 <0.53.0`.
`lexical`, `@lexical/clipboard`, `@lexical/extension`, and `@lexical/utils` must
be installed at the same version within that range.

React is not a package dependency or peer requirement. React hosts install
`@lexical/react` at the same version as `lexical`, plus matching `react` and
`react-dom` versions supported by that host integration. The demo browser
tests exercise React 18 and React 19.

CI exercises the supported Lexical minors and browser boundary scenarios in
Chromium, Firefox, and Playwright WebKit. Playwright WebKit results do not
certify native Safari or iOS Safari.

## Package API

Import nodes, document and session APIs, review operations, `ReviewExtension`,
and `registerReviewSession` from `lexical-review`.

The package has no runtime React imports or `"use client"` directive and can be
imported on the server without DOM globals. Rendering and browser input still
require a DOM environment when those operations run. React hosts declare their
client boundary in their own editor component.

`ReviewExtension` works with React or any other framework. It includes every
review node and manages input registration and cleanup.

## Core loop

Add the extension to your editor, open a validated native v3 review document,
then inspect or resolve proposals by ID:

```ts
import {
  buildEditorFromExtensions,
  getExtensionDependencyFromEditor,
} from "@lexical/extension";
import { configExtension } from "lexical";
import {
  $inspectReviewProposal,
  $resolveReviewProposal,
  $resolveReviewProposals,
  ReviewExtension,
} from "lexical-review";

const editor = buildEditorFromExtensions(
  configExtension(ReviewExtension, {
    initialDocument,
    options: { onOutcome },
  }),
);
editor.setRootElement(element);
const review = getExtensionDependencyFromEditor(editor, ReviewExtension).output;

editor.getEditorState().read(() => $inspectReviewProposal(proposalId));
editor.update(() => $resolveReviewProposal(proposalId, "accept"));
editor.update(() => $resolveReviewProposals(ids, "reject"));

const saved = review.session.value?.exportDocument();
// ... later: editor.dispose();
```

`initialDocument` defaults to `null`, leaving review input routing inactive.
To open a document later, call `review.openDocument(input)` after editor creation.
It returns the same validation result as `openReviewSession`; invalid or
unsupported input preserves the existing document and session. A configured
initial document opens after Lexical initializes its editor state; invalid or
unsupported initial input throws during editor creation.

The session reads the live `EditorState`; it does not keep a parallel
authoritative snapshot. Saving preserves current pending proposals only, with
no resolution history. `review.closeSession()` removes review input handlers
without changing the current document. Opening another valid document activates
routing again. Editor disposal removes handlers and clears the session signal.

### React

Use a stable root extension with `LexicalExtensionComposer`. Review nodes and
handlers are supplied by `ReviewExtension`; a React review plugin is unnecessary.

```tsx
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { configExtension, defineExtension } from "lexical";
import { ReviewExtension } from "lexical-review";

const extension = defineExtension({
  name: "my-review-editor",
  dependencies: [configExtension(ReviewExtension, { initialDocument })],
});

function Editor() {
  return (
    <LexicalExtensionComposer extension={extension} contentEditable={null}>
      <ContentEditable />
      <ReviewToolbar />
    </LexicalExtensionComposer>
  );
}
```

Children can retrieve the output with `getExtensionDependencyFromEditor(editor,
ReviewExtension).output`, using the editor from `useLexicalComposerContext`.
Replace `review.options.value` to update callbacks, clipboard projection, or the
proposal ID factory without reopening the document. Updates replace the full
options object and renew registration, just like direct cleanup and registration;
keep callback values stable and avoid changing options during composition.

### Direct registration

Hosts using `createEditor` can still register nodes themselves and call
`openReviewSession(editor, input)`, then
`registerReviewSession(editor, session.value, options)`.
Register with the same editor that opened the session and call the returned
cleanup when detaching it. Use either direct registration or the extension for
an active session so commands are registered once.

Through either integration, proposal resolution is available as
`RESOLVE_REVIEW_PROPOSALS_COMMAND` with payload `{ ids, action }`.
Unexpected implementation errors propagate to Lexical's update error handling
and rollback; do not swallow them inside the update callback.

### Migrating from v2

V3 uses proposal-bearing nodes and native v3 review documents in place of v2's
text-node review representation. Replace v2 `ReviewTextPlugin` / `registerReviewText` integration with
`ReviewExtension` and `LexicalExtensionComposer`, and follow the native document
and proposal APIs in this guide. There is no automatic v2 document conversion.
All v3 APIs are exported from `lexical-review`; the former client subpath and
review plugin are removed. Use the extension output to open documents and update
runtime options.

### Registration options

The default calls need no options: proposal IDs are generated, deletion is by character, and copy exports the all-accepted projection. Hosts that need more configure the extension options or pass them to direct registration:

```ts
review.options.value = {
  copyProjection: "accepted-state", // or "all-accepted" (default)
  onOutcome, // a claimed command may still report `refused`; plus onInsertionOutcome / onDeletionOutcome
};
```

A custom `proposalIdFactory` is only needed when an external scheme owns identity, such as server-assigned IDs or deterministic tests. In that case, pass the same factory to the extension options (or direct registration) and to each direct call, so typed and programmatic proposals share one scheme:

```ts
// Custom-scheme hosts only:
const proposalIdFactory = () => crypto.randomUUID();
review.options.value = { ...review.options.value, proposalIdFactory };
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

`INSERT_REVIEW_FRAGMENT_COMMAND` from `lexical-review` accepts already-normalized fragment content.

## Rendering contract

For inserted and deleted text, the review marker is always the outermost DOM element. Lexical formatting and inline styles are nested inside the marker, for example: `<ins><strong>inserted text</strong></ins>`. A pending merge displays `¶` inside `<del data-review-boundary="merge">`.

## Clipboard

- Copy and cut export content only (`text/plain` and `text/html`) with no proposal identity. Defaults to `copyProjection: "all-accepted"`; opt in to `"accepted-state"` when needed. See [clipboard projections](https://github.com/mahendrimd/lexical-review/blob/main/docs/proposal-behavior.md#clipboard-projections) for what each mode includes.
- Paste and copy-style drop insert through the same single-paragraph or atomic-fragment operations. Foreign markup never gains proposal identity.

## Interchange

The [`lexical-review-wer` package](https://github.com/mahendrimd/lexical-review/blob/main/packages/lexical-review-wer/README.md) owns the WER export boundary. Its guide describes the current export limitation; general import/export mapping is unimplemented.
